#!/usr/bin/env node
// Checks the NEXUS-4 processor core (rtl/*.vhd) against the ISA reference model, instruction by instruction.
//
// Every program is assembled by the NEXUS-4 assembler and written into the package nexus4_program; the core
// runs it in the testbench tests/core/tb_nexus4.vhd, which reports every commit. The model runs the same
// bytes with the same scratchpad sizes. They must agree on every commit: pc, instruction word, the register
// written and its value, the memory address and the value stored, and for the last one the trap, its cause
// and tval. The cycle count must be exactly what the instruction classes predict (D12: 3 cycles, 4 for a
// load), so the timing of the core is checked as well as its results.
//
//   1. on GHDL: tests/isa/*.s, tests/core/*.s, the cases of tests/isa/traps.txt and differences.txt,
//      the examples and idioms of the assembly Help,
//      random programs (NEXUS4_SEED, NEXUS4_FUZZ), and the riscv-tests rv32ui if RISCV_TESTS is set;
//      the same in PLANT (D55) and in ORBIT (D56), with the ORBIT programs early (1b);
//      the guardian's programs (1c, D59): its violations, codes and cycles as its reference model predicts;
//   2. on the NEXUS-4 kernel (the simulator the page uses): tests/core/smoke.s compared with GHDL delta cycle
//      by delta cycle (the D29 comparison of the examples), and tests/isa/*.s and tests/core/*.s compared
//      with the model commit by commit.
//
// Needs GHDL 4.1, GNU binutils for RISC-V (for the cases outside RV32I) and cpp (for riscv-tests).

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { randomProgram } from './isa-random.mjs';
import { loadKernel } from './kernel-runner.mjs';
import { runOracle } from './oracle.mjs';
import { compareTraces } from './differential.mjs';
import { loadNexus, rtlFiles, programPackage, designSource, modelRun, orbitModelRun, parseReports, coreOnKernel, hex8, read } from './core-sim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
// NEXUS4_RTL lets tools/core-mutations.mjs point the check at a deliberately broken copy of rtl/
const RTL_DIR = process.env.NEXUS4_RTL || join(ROOT, 'rtl');
const RTL = rtlFiles(RTL_DIR);
const N4 = loadNexus(INDEX);
const kernel = loadKernel(INDEX);
const designSourceOf = (pkg) => designSource(RTL, pkg);
const modelRunOf = (prog, pkg, limit) => modelRun(N4, prog, pkg, limit);
export { programPackage };

// ---------- running the core ----------
const work = mkdtempSync(join(tmpdir(), 'nexus4-core-'));
let analysed = false;
function ghdl(args, opts = {}) {
  const r = spawnSync('ghdl', args, { cwd: work, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.error) throw new Error(`cannot run ghdl: ${r.error.message}`);
  return r;
}
/**
 * The core on GHDL: the testbench's commit lines and the cycle count at HALT. The design is analysed and
 * elaborated once, with tests/core/program_from_file.vhd as nexus4_program; each run reads its program
 * from files, so a run costs only its simulation.
 */
function coreOnGhdl(pkg, stopNs) {
  const hexLines = (ws) => (ws.length ? ws : [0]).map(hex8).join('\n') + '\n';
  writeFileSync(join(work, 'program_text.hex'), hexLines(pkg.text));
  writeFileSync(join(work, 'program_data.hex'), hexLines(pkg.data));
  writeFileSync(join(work, 'program_sizes.txt'), `${pkg.imem}\n${pkg.dmem}\n${pkg.profile}\n${pkg.wdt}\n`);
  writeFileSync(join(work, 'program_sensors.hex'), hexLines(pkg.sensors));
  writeFileSync(join(work, 'program_guard.hex'), hexLines(pkg.guard || [0]));
  // (GHDL reads the program files while elaborating, so they are written first)
  if (!analysed) {
    for (const f of [RTL[0], join(ROOT, 'tests', 'core', 'program_from_file.vhd'), RTL[1], RTL[2], RTL[3]]) {
      const a = ghdl(['-a', '--std=08', f]);
      if (a.status) throw new Error(`GHDL analysis of ${f}: ${a.stderr}`);
    }
    const e = ghdl(['-e', '--std=08', 'tb_nexus4']);
    if (e.status) throw new Error(`GHDL elaboration: ${e.stderr}`);
    analysed = true;
  }
  const r = ghdl(['-r', '--std=08', 'tb_nexus4', `--stop-time=${stopNs}ns`]);
  return parseReports((r.stdout + r.stderr).split('\n').map((l) => (/\(report note\): (.*)$/.exec(l) || [])[1]).filter(Boolean));
}
/** The core on the NEXUS-4 kernel. */
function coreOnKernelOf(pkg, stopNs, withTrace = false) {
  return coreOnKernel(kernel, designSourceOf(pkg), stopNs, { snapshots: withTrace });
}

// ---------- comparing ----------
let checks = 0, failures = 0;
// NEXUS4_FAILFAST (tools/core-mutations.mjs): stop at the first failure
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); if (process.env.NEXUS4_FAILFAST) { rmSync(work, { recursive: true, force: true }); process.exit(1); } };
const FIELDS = ['', 'pc', 'instruction', 'rd', 'value', 'memory', 'address', 'data'];
function compareCommits(name, core, model, where) {
  checks++;
  const n = Math.max(core.lines.length, model.lines.length);
  for (let i = 0; i < n; i++) {
    if (core.lines[i] === model.lines[i]) continue;
    const c = (core.lines[i] || 'nothing').split(' '), m = (model.lines[i] || 'nothing').split(' ');
    const what = c[0] !== m[0] ? 'kind' : FIELDS[c.findIndex((x, k) => x !== m[k])] || 'field';
    fail(`${name} (${where}): commit ${i} differs in ${what}\n      core:  ${core.lines[i] || '(no commit)'}\n      model: ${model.lines[i] || '(no commit)'}`);
    return false;
  }
  if (model.halted && core.cycles !== model.cycles) {
    fail(`${name} (${where}): ${core.cycles} cycles, the instruction classes predict ${model.cycles}`);
    return false;
  }
  return true;
}

/**
 * GNU assembles what the NEXUS-4 assembler rightly refuses (fence.i, CSR instructions, wfi, mret: not RV32I),
 * so that the core can be shown to stop on them. Linked for the NEXUS-4 memory map.
 */
// GNU as has no name for NEXUS-4's marker (D58); this macro gives it one, as the same .insn
const GNU_PRELUDE = '.macro nx.mark a, b\n.ifb \\b\n.insn i 0x0b, 0, x0, x0, \\a\n.else\n.insn i 0x0b, 0, x0, \\a, \\b\n.endif\n.endm\n';
function gnuAssemble(source) {
  const s = join(work, 'g.s'), o = join(work, 'g.o'), elf = join(work, 'g.elf'), ld = join(work, 'g.ld');
  writeFileSync(s, GNU_PRELUDE + source);
  writeFileSync(ld, 'SECTIONS { . = 0x0; .text : { *(.text) } . = 0x10000; .data : { *(.data) } }\n');
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
  if (run('riscv64-unknown-elf-as', ['-march=rv32i_zicsr_zifencei', '-mabi=ilp32', '-mno-relax', '-o', o, s]).status) return null;
  if (run('riscv64-unknown-elf-ld', ['-m', 'elf32lriscv', '-T', ld, '-o', elf, o]).status) return null;
  const sect = (sec) => { const f = join(work, `g${sec}`); run('riscv64-unknown-elf-objcopy', ['-O', 'binary', '-j', sec, elf, f]); return existsSync(f) ? new Uint8Array(readFileSync(f)) : new Uint8Array(0); };
  return { ok: true, text: sect('.text'), data: sect('.data') };
}

/**
 * setup (D55): the profile, the watchdog and the sensors. In PLANT the system reports itself halted two
 * cycles later (the shadow core's lag), and the fault-free system must never trip by itself; the trip the
 * program asks for must be the model's.
 */
function check(name, source, { onKernel = false, limit = 200000, gnu = false, setup, guard, expect } = {}) {
  let prog = N4.asm.assemble(source);
  if (!prog.ok && gnu) prog = gnuAssemble(source) || prog;
  if (!prog.ok) { checks++; fail(`${name}: does not assemble: line ${prog.errors[0].line}: ${prog.errors[0].message}`); return; }
  let table = null;
  if (guard) {
    try { table = guard.tla ? N4.guard.buildTla(guard.tla, prog) : N4.guard.build(guard, prog); } catch (e) { checks++; fail(`${name}: the property set does not build: ${e.message}`); return; }
  }
  const pkg = programPackage(prog, { ...setup, guard: table ? table.words : [0] });
  const orbit = pkg.profile === 2;
  const run = orbit ? orbitModelRun(N4, prog, pkg, limit) : modelRunOf(prog, pkg, limit);
  if (!run.halted) { checks++; fail(`${name}: the model did not stop within ${limit} instructions`); return; }
  // the guardian (D59) stops BASE and PLANT: both cores at once, so without PLANT's lag
  const guardStop = !orbit && run.guards.length > 0;
  const lag = pkg.profile === 1 && !guardStop ? 2 : 0;
  // in PLANT a program that stops on a trap other than ecall is caught by the watchdog: the commits are
  // the model's, then the watchdog trips (its cycle is the watchdog's, not the program's)
  const trapped = pkg.profile === 1 && !guardStop && !/^T \S+ \S+ 11 /.test(run.lines.at(-1) + ' ');
  const model = { ...run, cycles: run.cycles + lag, halted: run.halted && !trapped };
  const wantTrip = run.machine.io.trip | (trapped ? 8 : 0) | (guardStop ? 16 : 0);
  const stopNs = 10 * (model.cycles + 10 + (trapped ? pkg.wdt : 0)) + 20;
  // ORBIT: a trap other than ecall restarts the core, three times, as the model predicts
  const restarts = (core, where) => {
    if (!orbit) return true;
    const got = core.restarts.map((r) => `${r.cause}@${r.cycle}`).join(' '), want = run.restarts.map((r) => `${r.cause}@${r.cycle}`).join(' ');
    if (got === want) return true;
    checks++;
    fail(`${name} (${where}): restarts [${got}], the model predicts [${want}]`);
    return false;
  };
  const trips = (core, where) => {
    const last = (core.trips.at(-1) || { causes: 0 }).causes;
    if (last === wantTrip) return true;
    checks++;
    fail(`${name} (${where}): the trip output is ${last.toString(16)} at the end, expected ${wantTrip.toString(16)}`);
    return false;
  };
  // the guardian's violations, each with its code and cycle, as the reference model predicts
  const show = (v) => v.map((x) => `${x.code}@${x.cycle}`).join(' ');
  const guards = (core, where) => {
    if (show(core.guards) === show(run.guards)) return true;
    checks++;
    fail(`${name} (${where}): the guardian reports [${show(core.guards)}], the model predicts [${show(run.guards)}]`);
    return false;
  };
  // what the program is there to show: its first violation (or none)
  if (expect !== undefined) {
    checks++;
    const first = run.guards[0] ? run.guards[0].code : 'none';
    if (String(first) !== String(expect)) { fail(`${name}: the model's first violation is ${first}${table && table.codes[first] ? ` (${table.codes[first]})` : ''}, the program expects ${expect}`); return; }
  }
  const g = coreOnGhdl(pkg, stopNs);
  if (!compareCommits(name, g, model, 'GHDL') || !trips(g, 'GHDL') || !restarts(g, 'GHDL') || !guards(g, 'GHDL')) return;
  let note = trapped ? `${model.lines.length} commits as predicted, then the watchdog trips` : `${model.lines.length} commits, ${model.cycles} cycles, as predicted`;
  if (run.restarts?.length) note = `${model.lines.length} commits in ${run.restarts.length + 1} runs, ${run.restarts.length} restart${run.restarts.length > 1 ? 's' : ''} and ${model.cycles} cycles, as predicted`;
  if (guard) note += run.guards.length ? `; the guardian: ${run.guards.map((v) => `${table.codes[v.code]} at cycle ${v.cycle}`).join(', ')}` : '; the guardian: no violation';
  if (onKernel) {
    const t0 = Date.now();
    const k = coreOnKernelOf(pkg, stopNs);
    if (!compareCommits(name, k, model, 'NEXUS-4 kernel') || !trips(k, 'NEXUS-4 kernel') || !restarts(k, 'NEXUS-4 kernel') || !guards(k, 'NEXUS-4 kernel')) return;
    note += `; NEXUS-4 kernel too (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
  }
  console.log(`ok    ${name}: ${note}`);
}

// 1. the programs
const progs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.s')).sort().map((f) => [f, read(join(dir, f))]) : []);
for (const [f, src] of [...progs(join(ROOT, 'tests', 'core')), ...progs(join(ROOT, 'tests', 'isa'))]) check(f, src, { onKernel: true });
// 1b. the ORBIT programs (D56), early, so that a broken restart or STATUS fails fast (core-mutations.mjs):
//     a trap and the watchdog restart the core, and the program sees it in STATUS
const ORBIT_WDT = { 'channel.s': 200, 'wdt_key.s': 60, 'obc.s': 80 };
const ORBIT_SETUP = { profile: 2, wdt: 0, sensors: [1520, 1480, 1530, 850] };
for (const [f, src] of progs(join(ROOT, 'tests', 'orbit'))) check(`${f} (ORBIT)`, src, { onKernel: true, setup: { ...ORBIT_SETUP, wdt: ORBIT_WDT[f] || 0 } });
// 1c. the guardian (D58, D59, D61): each program of tests/guard names its property module (@guard), its profile
//     (@profile, BASE if none) and the violation it is there to show (@expect: a code, or none). The
//     engine on GHDL and on the kernel must report what the reference model predicts, code and cycle;
//     the programs other than ORBIT's run in PLANT too, where the guardian stops both cores at once
const header = (src, key) => (new RegExp(`^#\\s*@${key}\\s+(\\S+)`, 'm').exec(src) || [])[1];
const PROFILES = { base: 0, plant: 1, orbit: 2 };
for (const [f, src] of progs(join(ROOT, 'tests', 'guard'))) {
  // the property module, in the TLA+ subset (D61)
  const spec = { tla: read(join(ROOT, 'tests', 'guard', header(src, 'guard'))) };
  const profile = PROFILES[header(src, 'profile') || 'base'];
  const expect = header(src, 'expect');
  check(`${f} (guardian${profile ? `, ${['', 'PLANT', 'ORBIT'][profile]}` : ''})`, src, { onKernel: true, guard: spec, expect, setup: { profile } });
  if (profile === 0) check(`${f} (guardian, PLANT)`, src, { guard: spec, expect, setup: { profile: 1 } });
}
// what the guardian cannot check must be refused when the table is built, with a reason (D18: the
// engine only adds and subtracts, and keeps whole words)
{
  const prog = N4.asm.assemble('  .data\nrods: .word 1\ncommand: .word 2\n  .half 3\nodd: .half 4\n  .text\n  nop\n');
  const base = { vars: { pos: 'rods', cmd: 'command' }, events: { a: 1, b: 2 } };
  const refused = [
    [{ invariants: ['pos + pos <= 3'] }, /coefficient/],
    [{ invariants: ['2 <= 3'] }, /no variable/],
    [{ invariants: ['pos * cmd <= 3'] }, /cannot read/],
    [{ invariants: ['rods <= 3'] }, /not a mapped variable/],
    [{ vars: { x: 'odd' } }, /word-aligned/],
    [{ vars: { x: 'nowhere' } }, /not a label in \.data/],
    [{ invariants: Array(9).fill('pos <= 1') }, /more than 8 invariants/],
    [{ events: { a: 1, b: 1 } }, /same marker number/],
    [{ events: { a: 2048 } }, /0\.\.2047/],
    [{ automata: [{ name: 'x', states: ['s'], init: 's', on: [['s', 'c', 's']] }] }, /not an event/],
    [{ deadlines: [{ name: 'x', after: 'a', until: 'a', within: 5 }] }, /same event/],
    [{ deadlines: [{ name: 'x', after: 'a', until: 'b', within: 0 }] }, /within must be/],
    [{ net: { places: Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, init: 0, cap: 1 })), trans: {} } }, /more than 8 places/],
    [{ net: { places: [{ name: 'p', init: 0, cap: 16 }], trans: {} } }, /capacity 16/],
    [{ net: { places: [{ name: 'p', init: 2, cap: 1 }], trans: {} } }, /more than its capacity/],
    [{ net: { places: [{ name: 'p', init: 0, cap: 3 }], trans: { a: { pre: { p: 4 }, post: {} } }, deadlock: 0 } }, /weight of 4/]
  ];
  let n = 0;
  for (const [extra, why] of refused) {
    checks++;
    try { N4.guard.build({ ...base, ...extra }, prog); fail(`the guardian builds a table for ${JSON.stringify(extra)}`); }
    catch (e) { if (why.test(e.message)) n++; else fail(`the guardian refuses ${JSON.stringify(extra)} for the wrong reason: ${e.message}`); }
  }
  // and the table it builds for an accepted set reads back as it was meant (the engine's layout)
  checks++;
  const t = N4.guard.build({ ...base, invariants: ['cmd - pos >= -7'], automata: [{ name: 'ab', states: ['s', 't'], init: 't', on: [['t', 'a', 's'], ['s', 'b', 't']] }], deadlines: [{ name: 'd', after: 'b', until: 'a', within: 1000 }] }, prog);
  const d = N4.guard.decode(t.words);
  const ok = t.words.length === N4.guard.SIZE && d.addr.join() === '65536,65540' && d.inv[0].c.join() === '-1,1' && d.inv[0].op === 4 && d.inv[0].k === -7 &&
    d.aut[0].init === 1 && d.aut[0].next(1, 0) === 0 && d.aut[0].next(1, 1) === 7 && d.aut[0].next(0, 1) === 1 && d.aut[0].next(7, 0) === 7 &&
    d.cnt[0].start === 1 && d.cnt[0].stop === 0 && d.cnt[0].limit === 1000 && N4.guard.decode([0]) === null;
  // and a Petri net's words (D62)
  const tn = N4.guard.build({ ...base, net: { places: [{ name: 'p', init: 2, cap: 3 }, { name: 'q', init: 0, cap: 15 }], trans: { a: { pre: { p: 2 }, post: { q: 3 } }, b: { pre: { q: 1 }, post: { p: 1, q: 1 } } }, final: { q: 3 }, deadlock: 77 } }, prog);
  const dn = N4.guard.decode(tn.words).net;
  const netOk = dn && dn.places === 2 && dn.init.join() === '2,0' && dn.cap.join() === '3,15' && dn.deadlock === 77 && dn.hasFinal && dn.fmask === 2 && dn.final[1] === 3 &&
    dn.pre[0].join() === '2,0' && dn.post[0].join() === '0,3' && dn.pre[1].join() === '0,1' && dn.post[1].join() === '1,1';
  if (!ok || !netOk) fail('the guardian\'s table does not read back as it was built');
  else if (n === refused.length) console.log(`ok    the guardian refuses ${n} property sets it cannot check, each with its reason, and its table reads back as built`);
}

// 2. smoke.s on the kernel against GHDL, delta cycle by delta cycle
{
  checks++;
  const prog = N4.asm.assemble(read(join(ROOT, 'tests', 'core', 'smoke.s')));
  const pkg = programPackage(prog);
  const model = modelRunOf(prog, pkg, 1000);
  const stop = 10 * (model.cycles + 10) + 20;
  const file = join(work, 'core_delta.vhd');
  writeFileSync(file, `-- @top: tb_nexus4\n-- @stop: ${stop}ns\n${designSourceOf(pkg)}`);
  const oracle = runOracle(file);
  const ours = kernel.simulate({ source: read(file), top: 'tb_nexus4', stop: `${stop}ns` });
  const diffs = compareTraces(oracle, ours);
  if (diffs.length) fail(`smoke.s, kernel against GHDL delta by delta:\n      ${diffs.slice(0, 6).join('\n      ')}`);
  else console.log(`ok    smoke.s: the NEXUS-4 kernel and GHDL agree on all ${oracle.snapshots.length} delta cycles of the core, every signal`);
}

// 3. traps and deliberate differences: the core must stop exactly where and how the model does
const PRE = '  .text\n  .globl _start\n_start:\n  nop\n';
const POST = '\n  nop\n  .data\nbuf: .word 0x11223344, 0x55667788\n  .align 3\ntohost: .word 0, 0\n';
for (const file of ['traps.txt', 'differences.txt']) {
  const cases = read(join(ROOT, 'tests', 'isa', file)).split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  let n = 0;
  for (const line of cases) {
    const code = line.split(/\s+=>\s+/)[0];
    const before = failures;
    check(`${file}: ${code}`, PRE + code.replace(/\\n/g, '\n') + POST, { limit: 50, gnu: true });
    if (failures === before) n++;
  }
  console.log(`ok    ${file}: ${n} of ${cases.length} cases stop the core as they stop the model`);
}

// 3b. the examples and idioms of the assembly Help (tools/help-check.mjs checks their results on the model;
//     here the core must run them commit for commit as the model does, in the predicted cycles)
{
  const H = N4.help;
  const all = [...H.instructions.map((x) => [`Help: ${x.n} example`, x.ex, x.ends]), ...H.idioms.map((x) => [`Help: idiom ${x.id}`, x.src, x.ends]), ...H.extras.map((x) => [`Help: chapter program ${x.id}`, x.src, x.ends])];
  let n = 0;
  for (const [name, src, ends] of all) {
    const before = failures;
    check(name, H.program(src, ends));
    if (failures === before) n++;
  }
  console.log(`ok    the Help: ${n} of ${all.length} examples, idioms and chapter programs run on the core as on the model`);
}

// 3c. the PLANT profile (D55): the same programs on two cores in delayed lockstep, with parity on the
//     scratchpads; the I/O page and the plant channel in both profiles; and the PLANT system on the
//     kernel against GHDL, delta cycle by delta cycle
{
  const PLANT = { profile: 1, wdt: 200, sensors: [1520, 1480, 1530, 850] };
  check('plant/channel.s (BASE)', read(join(ROOT, 'tests', 'plant', 'channel.s')), { onKernel: true, setup: { ...PLANT, profile: 0 } });
  let n = 0;
  const list = [...progs(join(ROOT, 'tests', 'plant')).filter(([f]) => f !== 'wdt_key.s'), ...progs(join(ROOT, 'tests', 'core')), ...progs(join(ROOT, 'tests', 'isa'))];
  for (const [f, src] of list) {
    const before = failures;
    // channel.s restarts the watchdog; the other programs do not, so theirs is set past their end
    const p = N4.asm.assemble(src), len = p.ok ? modelRunOf(p, programPackage(p), 200000).cycles : 0;
    check(`${f} (PLANT)`, src, { onKernel: true, setup: { ...PLANT, wdt: f === 'channel.s' ? 200 : len + 100 } });
    if (failures === before) n++;
  }
  const before = failures;
  check('random program (seed 4004, PLANT)', randomProgram(4004, 1500), { setup: { profile: 1 } });
  if (failures === before) n++;
  console.log(`ok    PLANT: ${n} of ${list.length + 1} programs run on two cores in lockstep as on the model, two cycles later, without a trip of their own`);
  // the watchdog's key: a 60-cycle watchdog, restarted once with the key and then only with 0, must trip
  // after the commits the model predicts for those 60 cycles, and stop the core
  {
    checks++;
    const p = N4.asm.assemble(read(join(ROOT, 'tests', 'plant', 'wdt_key.s')));
    const pk = programPackage(p, { profile: 1, wdt: 60 });
    const m = modelRunOf(p, pk, 1000);
    // the watchdog trips 60 cycles after the edge that ends the store of the key
    const k = m.lines.findIndex((l) => / S 00020014 5AFEC0DE$/.test(l));
    const due = m.lines.slice(0, k + 1).reduce((c, l) => c + (l.split(' ')[5] === 'L' ? 4 : 3), 0) + 60;
    for (const [where, core] of [['GHDL', coreOnGhdl(pk, 10 * (m.cycles + 20))], ['NEXUS-4 kernel', coreOnKernelOf(pk, 10 * (m.cycles + 20))]]) {
      const wd = core.trips.find((t) => t.causes & 8);
      const prefix = core.lines.every((l, i) => l === m.lines[i]);
      if (!wd || !prefix || core.lines.length >= m.lines.length || wd.cycle !== due) fail(`wdt_key.s (${where}): ${wd ? `the watchdog tripped at cycle ${wd.cycle}` : 'the watchdog did not trip'} after ${core.lines.length} commits${prefix ? '' : ' that differ from the model'}`);
      else console.log(`ok    wdt_key.s (${where}): only the key restarts the watchdog: it trips at cycle ${wd.cycle}, 60 after the key, and stops the core after ${core.lines.length} of the program's ${m.lines.length} commits`);
    }
  }
  checks++;
  const prog = N4.asm.assemble(read(join(ROOT, 'tests', 'plant', 'io_smoke.s')));
  const pkg = programPackage(prog, { ...PLANT, wdt: 100 });
  const model = modelRunOf(prog, pkg, 1000);
  const stop = 10 * (model.cycles + 12) + 20;
  const file = join(work, 'plant_delta.vhd');
  writeFileSync(file, `-- @top: tb_nexus4\n-- @stop: ${stop}ns\n${designSourceOf(pkg)}`);
  const oracle = runOracle(file);
  const ours = kernel.simulate({ source: read(file), top: 'tb_nexus4', stop: `${stop}ns` });
  const diffs = compareTraces(oracle, ours);
  if (diffs.length) fail(`plant/io_smoke.s in PLANT, kernel against GHDL delta by delta:\n      ${diffs.slice(0, 6).join('\n      ')}`);
  else console.log(`ok    plant/io_smoke.s in PLANT: the NEXUS-4 kernel and GHDL agree on all ${oracle.snapshots.length} delta cycles of both cores, the lockstep and the I/O page, every signal`);
}

// 3d. the ORBIT profile (D56): the SEC-DED code checked exhaustively; every program on the core with the
//     code, the votes and the scrubbers, commit for commit and cycle for cycle as on the model (so as on
//     BASE: protection costs no instruction a cycle); traps and the watchdog restart the core as the model
//     predicts, three times at most; and the ORBIT system on the kernel against GHDL, delta by delta
{
  const ORBIT = ORBIT_SETUP;
  {
    checks++;
    const src = read(join(ROOT, 'tests', 'orbit', 'ecc_selfcheck.vhd'));
    const file = join(work, 'ecc_selfcheck.vhd');
    writeFileSync(file, src.split('\n').slice(0, 2).join('\n') + '\n' + read(RTL[0]) + '\n' + src);
    const oracle = runOracle(file);
    const ours = kernel.simulate({ source: read(file), top: 'ecc_selfcheck', stop: '10ns' });
    const text = (r) => (r.reports || []).map((m) => m.text ?? m.message).join(' ');
    const want = 'singles corrected 156 of 156, doubles detected 2964 of 2964, wrong 0';
    const diffs = compareTraces(oracle, ours);
    if (text(oracle) !== want || text(ours) !== want || diffs.length) fail(`orbit/ecc_selfcheck.vhd: GHDL "${text(oracle)}", kernel "${text(ours)}"${diffs.length ? `; ${diffs[0]}` : ''}`);
    else console.log(`ok    orbit/ecc_selfcheck.vhd: the Hsiao (39,32) code corrects all 156 single-bit errors and detects all 2964 double-bit errors of four words, on GHDL and on the kernel alike`);
  }
  const WDT = ORBIT_WDT;
  // (tests/orbit ran in 1b)
  const list = [...progs(join(ROOT, 'tests', 'plant')), ...progs(join(ROOT, 'tests', 'core')), ...progs(join(ROOT, 'tests', 'isa'))];
  let n = 0;
  for (const [f, src] of list) {
    const before = failures;
    check(`${f} (ORBIT)`, src, { onKernel: true, setup: { ...ORBIT, wdt: WDT[f] || 0 } });
    if (failures === before) n++;
  }
  const cases = read(join(ROOT, 'tests', 'isa', 'traps.txt')).split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  for (const line of cases) {
    const before = failures;
    const code = line.split(/\s+=>\s+/)[0];
    check(`traps.txt (ORBIT): ${code}`, PRE + code.replace(/\\n/g, '\n') + POST, { limit: 50, gnu: true, setup: ORBIT });
    if (failures === before) n++;
  }
  const before = failures;
  check('random program (seed 4004, ORBIT)', randomProgram(4004, 1500), { setup: ORBIT });
  if (failures === before) n++;
  console.log(`ok    ORBIT: ${n} of ${list.length + cases.length + 1} more programs and trap cases run as on the model, in its cycles, restarted as it predicts`);
  checks++;
  const prog = N4.asm.assemble(read(join(ROOT, 'tests', 'orbit', 'orbit_smoke.s')));
  const pkg = programPackage(prog, ORBIT);
  const model = orbitModelRun(N4, prog, pkg, 1000);
  const stop = 10 * (model.cycles + 4) + 20;
  const file = join(work, 'orbit_delta.vhd');
  writeFileSync(file, `-- @top: tb_nexus4\n-- @stop: ${stop}ns\n${designSourceOf(pkg)}`);
  const oracle = runOracle(file);
  const ours = kernel.simulate({ source: read(file), top: 'tb_nexus4', stop: `${stop}ns` });
  const diffs = compareTraces(oracle, ours);
  if (diffs.length) fail(`orbit/orbit_smoke.s in ORBIT, kernel against GHDL delta by delta:\n      ${diffs.slice(0, 6).join('\n      ')}`);
  else console.log(`ok    orbit/orbit_smoke.s in ORBIT: the NEXUS-4 kernel and GHDL agree on all ${oracle.snapshots.length} delta cycles of the core, its votes and codes, the scrubbers and the restart, every signal`);
}

// 4. random programs
const SEEDS = (process.env.NEXUS4_SEED || '4004,1,2').split(',').map(Number);
const N = Number(process.env.NEXUS4_FUZZ || 3000);
for (const seed of SEEDS) check(`random program (seed ${seed}, ${N} statements)`, randomProgram(seed, N));

// 5. the official riscv-tests
if (process.env.RISCV_TESTS) {
  const dir = join(process.env.RISCV_TESTS, 'isa', 'rv32ui');
  const SKIP = new Set(['fence_i.S', 'ma_data.S']);   // as in tools/riscv-tests.mjs
  let n = 0, total = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.S') && !SKIP.has(f)).sort()) {
    total++;
    const cpp = spawnSync('cpp', ['-x', 'assembler-with-cpp', '-P', '-nostdinc', '-D__riscv_xlen=32', '-I', join(ROOT, 'tests', 'riscv-tests'),
      '-I', join(process.env.RISCV_TESTS, 'isa', 'macros', 'scalar'), join(dir, f)], { encoding: 'utf8' });
    const before = failures;
    check(`riscv-tests ${f}`, cpp.stdout);
    if (failures === before) n++;
  }
  console.log(`ok    riscv-tests rv32ui: ${n} of ${total} run on the core as on the model`);
}

rmSync(work, { recursive: true, force: true });
console.log(`\n${checks} core checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
