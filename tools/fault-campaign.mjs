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

const SOC = '.tb_nexus4(sim).soc@nexus4_soc(rtl)';
const CORE = '.tb_nexus4(sim).soc@nexus4_soc(rtl).core@nexus4_core(rtl)';
const SHADOW = '.tb_nexus4(sim).soc@nexus4_soc(rtl).plant.shadow@nexus4_core(rtl)';
const IO = '.tb_nexus4(sim).soc@nexus4_soc(rtl).io@nexus4_io(rtl)';
const LOCK = '.tb_nexus4(sim).soc@nexus4_soc(rtl).plant';
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
    { id: 'state', label: 'control state', bits: 3, set: 0,
      pick: (r) => ({ signal: `${CORE}.state`, value: null, r: r() }) },
    { id: 'ld', label: 'load registers (ld_f3, ld_lane, ld_addr)', bits: 37,
      pick: (r) => { const x = Math.floor(r() * 37); return x < 3 ? vec('ld_f3', 3)(() => x / 3) : x < 5 ? vec('ld_lane', 2)(() => (x - 3) / 2) : vec('ld_addr', 32)(() => (x - 5) / 32); } },
    { id: 'rdata', label: 'scratchpad read registers', bits: 64,
      pick: (r) => { const b = Math.floor(r() * 32); return { signal: `${r() < 0.5 ? IMEM : DMEM}.rdata(${b})`, b }; } },
  ];
}

/**
 * PLANT (D55): both cores, the scratchpads with their parity bits, the read registers, the lockstep
 * delay lines and flags, and the I/O page's state. Only state elements: a signal a clocked process
 * writes, or a memory nobody drives (an upset of a combinational net would last until its inputs
 * change, which is not what a transient does in hardware).
 */
function plantStructures(pkg) {
  const bit = (r, w) => Math.floor(r() * w);
  const pickOf = (list) => (r) => {   // list: [name, width] of vectors and std_logic (width 0) of one block
    const total = list.reduce((n, [, w]) => n + Math.max(1, w), 0);
    let x = Math.floor(r() * total);
    for (const [name, w] of list) {
      const k = Math.max(1, w);
      if (x < k) return { signal: w ? `${name}(${x})` : name };
      x -= k;
    }
    return { signal: list[0][0] };
  };
  const core = (P, who) => [
    { id: `${who}-regs`, label: `${who}: register file`, bits: 31 * 32, pick: (r) => ({ signal: `${P}.regs(${1 + bit(r, 31)})(${bit(r, 32)})` }) },
    { id: `${who}-pipe`, label: `${who}: pc, ir, a, b, load registers`, bits: 165,
      pick: pickOf([[`${P}.pc`, 32], [`${P}.ir`, 32], [`${P}.a`, 32], [`${P}.b`, 32], [`${P}.ld_addr`, 32], [`${P}.ld_f3`, 3], [`${P}.ld_lane`, 2]]) },
    { id: `${who}-state`, label: `${who}: control state`, bits: 3, set: who === 'shadow' ? 2 : 0, pick: (r) => ({ signal: `${P}.state`, r: r() }) },
    { id: `${who}-commit`, label: `${who}: commit port and halted`, bits: 200,
      pick: pickOf([[`${P}.commit`, 0], [`${P}.commit_pc`, 32], [`${P}.commit_insn`, 32], [`${P}.commit_wdata`, 32], [`${P}.commit_maddr`, 32], [`${P}.commit_mdata`, 32], [`${P}.commit_tval`, 32], [`${P}.commit_trap`, 0], [`${P}.halted`, 0]]) },
  ];
  return [
    ...core(CORE, 'first core'),
    ...core(SHADOW, 'shadow'),
    { id: 'imem', label: 'instruction scratchpad and parity', bits: pkg.imem * 33,
      pick: (r) => { const w = bit(r, pkg.imem), b = bit(r, 33); return { signal: b < 32 ? `${SOC}.imem@nexus4_imem(rtl).rom(${w})(${b})` : `${SOC}.imem@nexus4_imem(rtl).par(${w})` }; } },
    { id: 'dmem', label: 'data scratchpad and parity', bits: pkg.dmem * 33,
      pick: (r) => { const w = bit(r, pkg.dmem), b = bit(r, 33); return { signal: b < 32 ? `${SOC}.dmem@nexus4_dmem(rtl).ram(${w})(${b})` : `${SOC}.dmem@nexus4_dmem(rtl).par(${w})` }; } },
    { id: 'rdata', label: 'read registers (instruction, data, I/O)', bits: 99,
      pick: pickOf([[`${SOC}.imem@nexus4_imem(rtl).rdata`, 32], [`${SOC}.imem@nexus4_imem(rtl).rpar`, 0], [`${SOC}.dmem@nexus4_dmem(rtl).rdata`, 32],
        [`${SOC}.dmem@nexus4_dmem(rtl).rpar`, 0], [`${IO}.rdata`, 32], [`${IO}.rpar`, 0]]) },
    { id: 'lock', label: 'lockstep delay lines and flags', bits: 6 * 32 + 4 * 308 + 7,
      pick: pickOf([[`${LOCK}.i_d1`, 32], [`${LOCK}.i_d2`, 32], [`${LOCK}.rr_d1`, 32], [`${LOCK}.rr_d2`, 32], [`${LOCK}.ior_d1`, 32], [`${LOCK}.ior_d2`, 32],
        [`${LOCK}.m_d1`, 308], [`${LOCK}.m_d2`, 308], [`${LOCK}.s_read_io`, 0], [`${LOCK}.rst_d1`, 0], [`${LOCK}.rst_d2`, 0],
        [`${SOC}.read_io`, 0], [`${SOC}.read_ram`, 0], [`${SOC}.lockstep_err`, 0], [`${SOC}.parity_err`, 0], [`${SOC}.ended`, 0]]) },
    { id: 'io', label: 'I/O page: trip latches, watchdog counter', bits: 12 + 8,
      pick: (r) => { const x = bit(r, 20); return x < 12 ? { signal: `${IO}.causes_${'abc'[x >> 2]}(${x & 3})` } : { signal: `${IO}.wdt`, bit: x - 12 }; } },
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
  // PLANT: a trip from the hardware (lockstep, parity, the watchdog) is the fail-safe outcome
  if ((run.trips || []).some((t) => t.causes & 0xE)) return 'trip';
  if (!haltedAtAll) return 'hang';
  const last = run.lines[run.lines.length - 1] || '';
  const cause = last[0] === 'T' ? Number(last.split(' ')[3]) : null;
  if (cause !== 11) return 'DUE';
  const lastTrip = (x) => ((x.trips || []).at(-1) || { causes: 0 }).causes;
  if (lastTrip(run) !== lastTrip(golden)) return 'SDC';   // a trip lost, or one nobody asked for
  const same = run.lines.length === golden.lines.length && run.lines.every((l, i) => l === golden.lines[i]) && run.cycles === golden.cycles;
  if (same) return 'masked';
  const stores = (ls) => ls.filter((l) => l.split(' ')[5] === 'S').join('|');
  return stores(run.lines) === stores(golden.lines) ? 'late' : 'SDC';
}

export function campaign(programFile, { seed = SEED, per = PER, log = console.log, plant = false, setup = {} } = {}) {
  const prog = N4.asm.assemble(read(programFile));
  if (!prog.ok) throw new Error(`${programFile}: ${prog.errors[0].message}`);
  const pkg = plant ? programPackage(prog, PLANT_SETUP) : programPackage(prog, setup);
  const src = designSource(RTL, pkg);
  const model = modelRun(N4, prog, pkg, 200000);
  const stopNs = 10 * (2 * model.cycles + 10) + 20;
  const core = coreOnKernel(kernel, src, stopNs);
  if (core.lines.join('\n') !== model.lines.join('\n') || core.cycles !== model.cycles + (plant ? 2 : 0)) throw new Error('the fault-free core does not match the model');
  if (plant && core.trips.some((t) => t.causes & 0xE)) throw new Error('the fault-free PLANT system trips by itself');
  // the reference run: the model's commits; in PLANT, the system's cycles (two more: the shadow's lag) and trips
  const golden = { ...model, cycles: core.cycles, trips: core.trips };
  const starts = instructionStarts(golden.lines);
  const r = prng(seed);
  const results = [];
  let oracleChecks = 0, oracleFailures = 0;
  const latencies = [];
  for (const st of plant ? plantStructures(pkg) : structures(pkg)) {
    const counts = plant ? { masked: 0, trip: 0, late: 0, SDC: 0, DUE: 0, hang: 0 } : { masked: 0, late: 0, SDC: 0, DUE: 0, hang: 0 };
    for (let j = 0; j < per; j++) {
      // (in PLANT not before cycle 3: the lockstep's delay lines hold 'U' until reset has passed through them)
      const n = Math.max(plant ? 3 : 1, 1 + Math.floor(r() * (golden.cycles - 2)));
      const f = st.pick(r);
      const fault = { signal: f.signal, at: `${10 * n}ns`, kind: st.set !== undefined ? 'set' : 'flip', bit: f.bit };
      if (st.set !== undefined) {
        // the state is an enumeration; an upset moves it to another of its values (VHDL cannot hold an
        // encoding that is none of them)
        const cur = STATES[phaseAt(Math.max(1, n - (st.set || 0)), starts)];   // the shadow runs two cycles behind
        const others = STATES.filter((s) => s !== cur);
        fault.value = others[Math.floor(f.r * others.length)];
      }
      let run;
      try { run = coreOnKernel(kernel, src, stopNs, { faults: [fault] }); }
      catch (e) { log(`FAIL  ${st.id}: the kernel refused ${fault.signal} at ${fault.at}: ${e.message}`); oracleFailures++; continue; }
      const outcome = classify(golden, run, run.cycles !== null);
      counts[outcome]++;
      const hw = (run.trips || []).find((t) => t.causes & 0xE);
      if (hw) latencies.push(hw.cycle - n);
      const lastTrip = (x) => ((x.trips || []).at(-1) || { causes: 0 }).causes & 1;
      results.push({ structure: st.id, signal: fault.signal, cycle: n, kind: fault.kind, value: fault.value, outcome, trip: hw ? hw.causes & 0xE : 0, latency: hw ? hw.cycle - n : null,
        tripLost: !hw && lastTrip(golden) === 1 && lastTrip(run) === 0 });
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
  if (plant) {
    // Aimed upsets with a known answer: each mechanism of PLANT must catch the upset it exists for. The
    // channel loads its setpoints (data words 0 and 1) in every pass and reads its sensors from the I/O page.
    const AIMED = [
      ['an operand register of the first core', `${CORE}.regs(18)(4)`, 20, 2],          // s2: the setpoints' address
      ['the shadow core\'s pc', `${SHADOW}.pc(3)`, 200, 2],
      ['a setpoint in the data scratchpad', `${SOC}.dmem@nexus4_dmem(rtl).ram(0)(2)`, 10, 4],
      ['an instruction word in the loop', `${SOC}.imem@nexus4_imem(rtl).rom(10)(6)`, 15, 4],
      ['the I/O read register before a sensor arrives', `${IO}.rpar`, 31, 4],
      ['the first core\'s RAM-or-I/O choice', `${SOC}.read_io`, 31, 2],
      ['the first core\'s commit port', `${CORE}.commit_wdata(0)`, 40, 2],
    ];
    let aimedFailures = 0;
    for (const [what, signal, n, want] of AIMED) {
      const run = coreOnKernel(kernel, src, stopNs, { faults: [{ signal, at: `${10 * n}ns`, kind: 'flip' }] });
      const hw = (run.trips || []).find((t) => t.causes & 0xE);
      if (!hw || !(hw.causes & want)) { aimedFailures++; log(`FAIL  aimed: ${what} (${signal} at cycle ${n}): expected a ${want === 2 ? 'lockstep' : 'parity'} trip, got ${hw ? `causes ${hw.causes}` : 'no trip'}`); }
    }
    // and an upset that clears one copy of the trip latch after the trip must not clear the trip
    const tripCycle = (golden.trips[0] || {}).cycle;
    const run = coreOnKernel(kernel, src, stopNs, { faults: [{ signal: `${IO}.causes_b(0)`, at: `${10 * (tripCycle + 20)}ns`, kind: 'flip' }] });
    // (every pass of the channel trips again, so the trip output must never drop, not just end set)
    if (!run.trips.length || run.trips.some((t) => t.cycle > tripCycle && (t.causes & 1) !== 1)) { aimedFailures++; log('FAIL  aimed: an upset of one copy of the trip latch cleared the trip'); }
    log(`${'aimed: each mechanism against its own upset'.padEnd(42)} ${String(AIMED.length + 1).padStart(6)} upsets, ${aimedFailures} not caught as they must be`);
    return { results, latencies, aimedFailures, oracleChecks, oracleFailures, golden: { commits: golden.lines.length, cycles: golden.cycles }, per, seed };
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
    const maddr = Number.parseInt(x.f[6], 16);
    if ((x.f[5] === 'L' || x.f[5] === 'S') && maddr >= 0x10000 && maddr < 0x10000 + 4 * pkg.dmem) {   // not the I/O page
      const dw = (maddr - 0x10000) >>> 2;
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

// the PLANT setup of tests/plant/channel.s: two of three pressures above the setpoint (it must trip),
// the watchdog at 200 cycles (a pass restarts it every 90 or so)
export const PLANT_SETUP = { profile: 1, wdt: 200, sensors: [1520, 1480, 1530, 850] };

function mainPlant() {
  const file = join(ROOT, 'tests', 'plant', 'channel.s');
  const t0 = Date.now();
  console.log(`Single-event upsets in the PLANT system running ${file.split('/').pop()} (seed ${SEED}, ${PER} per structure)\n`);
  const res = campaign(file, { plant: true });
  const tot = { masked: 0, trip: 0, late: 0, SDC: 0, DUE: 0, hang: 0 };
  for (const x of res.results) tot[x.outcome]++;
  const by = { 2: 0, 4: 0, 8: 0 };
  for (const x of res.results) if (x.trip) for (const b of [2, 4, 8]) if (x.trip & b) by[b]++;
  const lat = res.latencies.slice().sort((a, b) => a - b);
  console.log(`\n${res.results.length} upsets: ${Object.entries(tot).map(([k, v]) => `${k} ${v}`).join(', ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`trips by cause: lockstep ${by[2]}, parity ${by[4]}, watchdog ${by[8]}; cycles from the upset to the trip: median ${lat[lat.length >> 1] ?? '-'}, max ${lat.at(-1) ?? '-'}`);
  const unsafe = tot.SDC + tot.hang + tot.DUE + res.aimedFailures + res.oracleFailures;
  for (const x of res.results.filter((y) => ['SDC', 'hang', 'DUE'].includes(y.outcome))) console.log(`FAIL  ${x.outcome}: ${x.signal} at cycle ${x.cycle}`);
  console.log(unsafe ? `${unsafe} upsets were neither masked nor caught.` : 'Every upset was masked or ended in a trip: no silent data corruption, no hang.');
  if (process.env.NEXUS4_CAMPAIGN_JSON) writeFileSync(process.env.NEXUS4_CAMPAIGN_JSON, JSON.stringify(res, null, 1));
  process.exit(unsafe ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('fault-campaign.mjs') && process.argv[2] === '--plant') mainPlant();
else if (process.argv[1] && process.argv[1].endsWith('fault-campaign.mjs')) {
  const file = process.argv[2] || join(ROOT, 'tests', 'isa', 'protection_scan.s');
  const t0 = Date.now();
  console.log(`Single-event upsets in the unprotected core running ${file.split('/').pop()} (seed ${SEED}, ${PER} per structure)\n`);
  // the plant channel gets its sensors on the unprotected core too (no watchdog), for the comparison
  const res = campaign(file, { setup: file.endsWith('channel.s') ? { ...PLANT_SETUP, profile: 0, wdt: 0 } : {} });
  const tot = { masked: 0, late: 0, SDC: 0, DUE: 0, hang: 0 };
  for (const x of res.results) tot[x.outcome]++;
  console.log(`\n${res.results.length} upsets: ${Object.entries(tot).map(([k, v]) => `${k} ${v}`).join(', ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const lost = res.results.filter((x) => x.tripLost).length;
  if (lost) console.log(`${lost} of them lost the trip the channel had to make: the plant would not have been protected.`);
  console.log(`${res.oracleChecks} upsets in architectural state checked against the ISA model with the same upset: ${res.oracleFailures} disagree.`);
  if (process.env.NEXUS4_CAMPAIGN_JSON) writeFileSync(process.env.NEXUS4_CAMPAIGN_JSON, JSON.stringify(res, null, 1));
  process.exit(res.oracleFailures ? 1 : 0);
}
