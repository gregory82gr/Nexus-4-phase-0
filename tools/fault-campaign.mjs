#!/usr/bin/env node
// A fault-injection campaign on the NEXUS-4 core (D52, Phase 2 step 2): single-event upsets in the state
// of the unprotected core, while it runs a program on the NEXUS-4 kernel, and what each one does.
//
// Every upset is a deposit (kernel 0.4): one bit of one state element flips in the middle of a clock
// cycle and stays flipped until the element is written again. The outcome is classified against the
// fault-free run:
//   masked  the program ends normally with exactly the same commits (results, stores, timing);
//   late    it ends normally with the same stores (the program's outputs) but a different path or time:
//           harmless for the results, not for a deadline;
//   SDC     silent data corruption: it ends normally, with different stores;
//   DUE     detected unrecoverable error: the core stops on a trap other than ecall (the fail-safe stop);
//   hang    no stop within twice the fault-free cycles.
//
// The oracle for architectural state (the register file, the data and instruction scratchpads) is the
// ISA reference model: an upset there is the same as the model with that bit flipped between two
// instructions, at the point the core's fixed timing gives (D12). For every such fault, the core's
// commits and cycles must be exactly those of the model with the flip. Upsets in the microarchitecture
// (pc, ir, a, b, the control state, the load registers, the scratchpads' read registers) have no ISA
// equivalent; their outcomes are reported, and the deposit itself is checked against GHDL by
// tools/fault-check.mjs.
//
// Usage: node tools/fault-campaign.mjs [program.s]   (NEXUS4_SEED, NEXUS4_PER: faults per structure)

import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadKernel } from './kernel-runner.mjs';
import { ROOT, read, loadNexus, rtlFiles, programPackage, designSource, modelRun, coreOnKernel } from './core-sim.mjs';

const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const RTL = rtlFiles(process.env.NEXUS4_RTL || join(ROOT, 'rtl'));
const SEED = Number(process.env.NEXUS4_SEED || 4004);
const PER = Number(process.env.NEXUS4_PER || 24);
const N4 = loadNexus(INDEX);
const kernel = loadKernel(INDEX);

const CORE = '.tb_nexus4(sim).soc@nexus4_soc(rtl).core@nexus4_core(rtl)';
const IMEM = '.tb_nexus4(sim).soc@nexus4_soc(rtl).imem@nexus4_imem(rtl)';
const DMEM = '.tb_nexus4(sim).soc@nexus4_soc(rtl).dmem@nexus4_dmem(rtl)';
const STATES = ['s_fetch', 's_decode', 's_exec', 's_mem', 's_halt'];

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** The structures upset, with how to name a random bit of each. Architectural ones carry an ISA flip. */
function structures(pkg) {
  const vec = (name, width) => (r) => { const b = Math.floor(r() * width); return { signal: `${CORE}.${name}(${b})`, bit: b }; };
  return [
    { id: 'regs', label: 'register file (x1–x31)', bits: 31 * 32, arch: 'reg',
      pick: (r) => { const k = 1 + Math.floor(r() * 31), b = Math.floor(r() * 32); return { signal: `${CORE}.regs(${k})(${b})`, k, b }; } },
    { id: 'dmem', label: 'data scratchpad', bits: pkg.dmem * 32, arch: 'dmem',
      pick: (r) => { const w = Math.floor(r() * pkg.dmem), b = Math.floor(r() * 32); return { signal: `${DMEM}.ram(${w})(${b})`, w, b }; } },
    { id: 'imem', label: 'instruction scratchpad', bits: pkg.imem * 32, arch: 'imem',
      pick: (r) => { const w = Math.floor(r() * pkg.imem), b = Math.floor(r() * 32); return { signal: `${IMEM}.rom(${w})(${b})`, w, b }; } },
    { id: 'pc', label: 'pc', bits: 32, pick: vec('pc', 32) },
    { id: 'ir', label: 'ir (the instruction)', bits: 32, pick: vec('ir', 32) },
    { id: 'ab', label: 'a and b (the operands)', bits: 64, pick: (r) => vec(r() < 0.5 ? 'a' : 'b', 32)(r) },
    { id: 'state', label: 'control state', bits: 3, set: true,
      pick: (r) => ({ signal: `${CORE}.state`, value: null, r: r() }) },
    { id: 'ld', label: 'load registers (ld_f3, ld_lane, ld_addr)', bits: 37,
      pick: (r) => { const x = Math.floor(r() * 37); return x < 3 ? vec('ld_f3', 3)(() => x / 3) : x < 5 ? vec('ld_lane', 2)(() => (x - 3) / 2) : vec('ld_addr', 32)(() => (x - 5) / 32); } },
    { id: 'rdata', label: 'scratchpad read registers', bits: 64,
      pick: (r) => { const b = Math.floor(r() * 32); return { signal: `${r() < 0.5 ? IMEM : DMEM}.rdata(${b})`, b }; } },
  ];
}

/** Each instruction's first cycle (cycle 1 is the first FETCH after reset) from the model's commits. */
function instructionStarts(lines) {
  const starts = [];
  let c = 1;
  for (const l of lines) {
    starts.push(c);
    const f = l.split(' ');
    c += f[0] === 'T' ? (f[2] === '00000000' && f[3] === '1' ? 1 : 3) : f[5] === 'L' ? 4 : 3;
  }
  return starts;
}

/** The control state during cycle n: 0 FETCH, 1 DECODE, 2 EXEC, 3 MEM (from the fixed timing). */
function phaseAt(n, starts) {
  let i = starts.length - 1;
  while (i > 0 && starts[i] > n) i--;
  return Math.min(3, n - starts[i]);
}

/**
 * Where an upset in architectural state, in the middle of cycle n, falls in the model's instruction order.
 * The core reads rs1/rs2 at the end of DECODE, writes rd at the end of EXEC (MEM for a load), reaches the
 * data scratchpad at the end of EXEC and fetches at the end of FETCH. Returns { before: i } to flip before
 * instruction i, or { none: true } when the instruction in flight overwrites the flipped register.
 */
function isaPoint(kind, n, starts, lines, f) {
  let i = starts.length - 1;
  while (i > 0 && starts[i] > n) i--;
  const phase = n - starts[i];                       // 0 FETCH, 1 DECODE, 2 EXEC, 3 MEM
  if (kind === 'reg') {
    if (phase <= 1) return { before: i };
    const rd = Number(lines[i].split(' ')[3]);
    return rd === f.k && lines[i][0] === 'C' ? { none: true } : { before: i + 1 };
  }
  if (kind === 'dmem') return { before: phase <= 2 ? i : i + 1 };
  return { before: phase === 0 ? i : i + 1 };        // imem
}

function flipModel(kind, f, m) {
  if (kind === 'reg') m.x[f.k] ^= (1 << f.b);
  else { const mem = kind === 'dmem' ? m.dmem : m.imem; mem[4 * f.w + (f.b >> 3)] ^= 1 << (f.b & 7); }
}

function classify(golden, run, haltedAtAll) {
  if (!haltedAtAll) return 'hang';
  const last = run.lines[run.lines.length - 1] || '';
  const cause = last[0] === 'T' ? Number(last.split(' ')[3]) : null;
  if (cause !== 11) return 'DUE';
  const same = run.lines.length === golden.lines.length && run.lines.every((l, i) => l === golden.lines[i]) && run.cycles === golden.cycles;
  if (same) return 'masked';
  const stores = (ls) => ls.filter((l) => l.split(' ')[5] === 'S').join('|');
  return stores(run.lines) === stores(golden.lines) ? 'late' : 'SDC';
}

export function campaign(programFile, { seed = SEED, per = PER, log = console.log } = {}) {
  const prog = N4.asm.assemble(read(programFile));
  if (!prog.ok) throw new Error(`${programFile}: ${prog.errors[0].message}`);
  const pkg = programPackage(prog);
  const src = designSource(RTL, pkg);
  const golden = modelRun(N4, prog, pkg, 200000);
  const stopNs = 10 * (2 * golden.cycles + 10) + 20;
  const core = coreOnKernel(kernel, src, stopNs);
  if (core.lines.join('\n') !== golden.lines.join('\n') || core.cycles !== golden.cycles) throw new Error('the fault-free core does not match the model');
  const starts = instructionStarts(golden.lines);
  const r = prng(seed);
  const results = [];
  let oracleChecks = 0, oracleFailures = 0;
  for (const st of structures(pkg)) {
    const counts = { masked: 0, late: 0, SDC: 0, DUE: 0, hang: 0 };
    for (let j = 0; j < per; j++) {
      const n = 1 + Math.floor(r() * (golden.cycles - 2));
      const f = st.pick(r);
      const fault = { signal: f.signal, at: `${10 * n}ns`, kind: st.set ? 'set' : 'flip' };
      if (st.set) {
        // the state is an enumeration; an upset moves it to another of its values (VHDL cannot hold an
        // encoding that is none of them)
        const cur = STATES[phaseAt(n, starts)];
        const others = STATES.filter((s) => s !== cur);
        fault.value = others[Math.floor(f.r * others.length)];
      }
      let run;
      try { run = coreOnKernel(kernel, src, stopNs, { faults: [fault] }); }
      catch (e) { log(`FAIL  ${st.id}: the kernel refused ${fault.signal} at ${fault.at}: ${e.message}`); oracleFailures++; continue; }
      const outcome = classify(golden, run, run.cycles !== null);
      counts[outcome]++;
      results.push({ structure: st.id, signal: fault.signal, cycle: n, kind: fault.kind, value: fault.value, outcome });
      if (st.arch) {
        oracleChecks++;
        const p = isaPoint(st.arch, n, starts, golden.lines, f);
        const model = p.none ? golden : modelRun(N4, prog, pkg, 3 * golden.lines.length + 100, (i, m) => { if (i === p.before) flipModel(st.arch, f, m); });
        const coreLines = run.lines.join('\n'), modelLines = model.lines.join('\n');
        const hang = run.cycles === null;
        const agree = hang ? !model.halted || model.cycles > 2 * golden.cycles : coreLines === modelLines && run.cycles === model.cycles;
        if (!agree) {
          oracleFailures++;
          const k = run.lines.findIndex((l, i) => l !== model.lines[i]);
          log(`FAIL  ${st.id}: ${fault.signal} at cycle ${n}: the core and the model with the same upset disagree at commit ${k}\n      core:  ${run.lines[k] || '(none)'}\n      model: ${model.lines[k] || '(none)'}`);
        }
      }
    }
    log(`${st.label.padEnd(42)} ${String(st.bits).padStart(6)} bits   ${Object.entries(counts).map(([k, v]) => `${k} ${String(v).padStart(2)}`).join('   ')}`);
  }

  // Random upsets rarely hit the register, word or instruction in use at that moment, so they say little
  // about the timing of the core's reads and writes. These upsets do: each one hits the operand, the
  // result register, the memory word or the instruction word of an instruction, in each of its cycles,
  // and the core must still agree with the model. (They are aimed, so they are not in the outcome counts.)
  const insts = golden.lines.map((l, i) => ({ i, f: l.split(' ') })).filter((x) => x.f[0] === 'C');
  const aimed = [];
  for (let j = 0; j < per; j++) {
    const x = insts[Math.floor(r() * insts.length)];
    const insn = parseInt(x.f[2], 16), len = x.f[5] === 'L' ? 4 : 3, phase = Math.floor(r() * len), b = Math.floor(r() * 32);
    const n = starts[x.i] + phase;
    const rs1 = (insn >>> 15) & 31, rd = Number(x.f[3]);
    const k = r() < 0.5 && rd ? rd : rs1;
    if (k) aimed.push({ arch: 'reg', n, f: { signal: `${CORE}.regs(${k})(${b})`, k, b } });
    const w = Number.parseInt(x.f[1], 16) >>> 2;
    aimed.push({ arch: 'imem', n, f: { signal: `${IMEM}.rom(${w})(${b})`, w, b } });
    if (x.f[5] === 'L' || x.f[5] === 'S') {
      const dw = (Number.parseInt(x.f[6], 16) - 0x10000) >>> 2;
      aimed.push({ arch: 'dmem', n, f: { signal: `${DMEM}.ram(${dw})(${b})`, w: dw, b } });
    }
  }
  let aimedChecks = 0;
  for (const a of aimed) {
    const run = coreOnKernel(kernel, src, stopNs, { faults: [{ signal: a.f.signal, at: `${10 * a.n}ns`, kind: 'flip' }] });
    const p = isaPoint(a.arch, a.n, starts, golden.lines, a.f);
    const model = p.none ? golden : modelRun(N4, prog, pkg, 3 * golden.lines.length + 100, (i, m) => { if (i === p.before) flipModel(a.arch, a.f, m); });
    oracleChecks++; aimedChecks++;
    const hang = run.cycles === null;
    const agree = hang ? !model.halted || model.cycles > 2 * golden.cycles : run.lines.join('\n') === model.lines.join('\n') && run.cycles === model.cycles;
    if (!agree) {
      oracleFailures++;
      const k = run.lines.findIndex((l, i) => l !== model.lines[i]);
      log(`FAIL  aimed ${a.arch}: ${a.f.signal} at cycle ${a.n}: the core and the model with the same upset disagree at commit ${k}\n      core:  ${run.lines[k] || '(none)'}\n      model: ${model.lines[k] || '(none)'}`);
    }
  }
  log(`${'aimed at the operands, results and words in use'.padEnd(42)} ${String(aimedChecks).padStart(6)} upsets, each checked against the model`);
  return { results, oracleChecks, oracleFailures, golden: { commits: golden.lines.length, cycles: golden.cycles }, per, seed };
}

if (process.argv[1] && process.argv[1].endsWith('fault-campaign.mjs')) {
  const file = process.argv[2] || join(ROOT, 'tests', 'isa', 'protection_scan.s');
  const t0 = Date.now();
  console.log(`Single-event upsets in the unprotected core running ${file.split('/').pop()} (seed ${SEED}, ${PER} per structure)\n`);
  const res = campaign(file);
  const tot = { masked: 0, late: 0, SDC: 0, DUE: 0, hang: 0 };
  for (const x of res.results) tot[x.outcome]++;
  console.log(`\n${res.results.length} upsets: ${Object.entries(tot).map(([k, v]) => `${k} ${v}`).join(', ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`${res.oracleChecks} upsets in architectural state checked against the ISA model with the same upset: ${res.oracleFailures} disagree.`);
  if (process.env.NEXUS4_CAMPAIGN_JSON) writeFileSync(process.env.NEXUS4_CAMPAIGN_JSON, JSON.stringify(res, null, 1));
  process.exit(res.oracleFailures ? 1 : 0);
}
