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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
// NEXUS4_RTL lets tools/core-mutations.mjs point the check at a deliberately broken copy of rtl/
const RTL_DIR = process.env.NEXUS4_RTL || join(ROOT, 'rtl');
const RTL = [join(RTL_DIR, 'nexus4_pkg.vhd'), join(RTL_DIR, 'nexus4_core.vhd'), join(RTL_DIR, 'nexus4_soc.vhd'), join(ROOT, 'tests', 'core', 'tb_nexus4.vhd')];
const read = (f) => readFileSync(f, 'utf8');

function loadNexus() {
  const html = read(INDEX);
  const sb = { console };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const id of ['nexus4-asm', 'nexus4-isa', 'nexus4-help']) {
    const open = `<script id="${id}">`;
    const a = html.indexOf(open);
    vm.runInContext(html.slice(a + open.length, html.indexOf('</script>', a)), sb, { filename: `${id}.js` });
  }
  return sb.NEXUS4;
}
const N4 = loadNexus();
const kernel = loadKernel(INDEX);

// ---------- the program package ----------
const pow2 = (n) => { let p = 16; while (p < n) p *= 2; return p; };
const words = (bytes) => {
  const out = [];
  for (let i = 0; i < bytes.length; i += 4) out.push(((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0));
  return out;
};
const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0').toUpperCase();
/** The VHDL package nexus4_program for an assembled program: the words, and scratchpad sizes that hold them. */
export function programPackage(prog) {
  const text = words(prog.text), data = words(prog.data);
  const imem = pow2(text.length), dmem = pow2(data.length);
  const agg = (ws) => {
    if (!ws.length) ws = [0];
    if (ws.length === 1) return `(0 => x"${hex8(ws[0])}")`;
    const lines = [];
    for (let i = 0; i < ws.length; i += 6) lines.push('    ' + ws.slice(i, i + 6).map((w) => `x"${hex8(w)}"`).join(', '));
    return `(\n${lines.join(',\n')})`;
  };
  return {
    imem, dmem, text, data,
    vhdl: `-- Written by tools/core-check.mjs from an assembled program.
library ieee;
use ieee.std_logic_1164.all;
use work.nexus4_pkg.all;

package nexus4_program is
  constant PROGRAM_TEXT : word_array := ${agg(text)};
  constant PROGRAM_DATA : word_array := ${agg(data)};
  constant PROGRAM_IMEM_WORDS : positive := ${imem};
  constant PROGRAM_DMEM_WORDS : positive := ${dmem};
end package;
`
  };
}
/** The whole design as one source: package, program, core, SoC, testbench. */
const designSource = (pkg) => [read(RTL[0]), pkg.vhdl, read(RTL[1]), read(RTL[2]), read(RTL[3])].join('\n');

// ---------- the model's commits, in the testbench's format ----------
const CYCLES = (r) => (r.trap ? (r.insn === undefined ? 1 : 3) : r.mem && !r.mem.store ? 4 : 3);
function modelRun(prog, pkg, limit) {
  const m = new N4.isa.Machine({ imem: { size: 4 * pkg.imem }, dmem: { size: 4 * pkg.dmem } });
  m.load(prog);
  const lines = [];
  let cycles = 1;   // the testbench counts one more cycle: halted rises one cycle after the trap commits
  for (let i = 0; i < limit; i++) {
    const r = m.step();
    cycles += CYCLES(r);
    if (r.trap) { lines.push(`T ${hex8(r.pc)} ${hex8(r.insn ?? 0)} ${r.trap.cause} ${hex8(r.trap.tval)}`); break; }
    const rd = r.rd ?? 0;
    const mem = r.mem ? (r.mem.store ? `S ${hex8(r.mem.addr)} ${hex8(r.mem.data)}` : `L ${hex8(r.mem.addr)} 00000000`) : 'N 00000000 00000000';
    lines.push(`C ${hex8(r.pc)} ${hex8(r.insn)} ${rd} ${rd ? hex8(r.wdata) : null} ${mem}`);
  }
  return { lines, cycles, halted: !!m.halted };
}

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
  writeFileSync(join(work, 'program_sizes.txt'), `${pkg.imem}\n${pkg.dmem}\n`);
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
function coreOnKernel(pkg, stopNs, withTrace = false) {
  const res = kernel.simulate({ source: designSource(pkg), top: 'tb_nexus4', stop: `${stopNs}ns`, snapshots: withTrace, log: false });
  return { ...parseReports(res.reports.map((m) => m.text ?? m.message)), res };
}
function parseReports(msgs) {
  const lines = [];
  let cycles = null;
  for (const t of msgs) {
    const h = /^HALT after (\d+) cycles$/.exec(t);
    if (h) { cycles = Number(h[1]); continue; }
    if (/^[CT] /.test(t)) {
      const f = t.split(' ');
      // the register value means nothing when no register is written
      if (f[0] === 'C' && f[3] === '0') f[4] = 'null';
      lines.push(f.join(' '));
    }
  }
  return { lines, cycles };
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
function gnuAssemble(source) {
  const s = join(work, 'g.s'), o = join(work, 'g.o'), elf = join(work, 'g.elf'), ld = join(work, 'g.ld');
  writeFileSync(s, source);
  writeFileSync(ld, 'SECTIONS { . = 0x0; .text : { *(.text) } . = 0x10000; .data : { *(.data) } }\n');
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
  if (run('riscv64-unknown-elf-as', ['-march=rv32i_zicsr_zifencei', '-mabi=ilp32', '-mno-relax', '-o', o, s]).status) return null;
  if (run('riscv64-unknown-elf-ld', ['-m', 'elf32lriscv', '-T', ld, '-o', elf, o]).status) return null;
  const sect = (sec) => { const f = join(work, `g${sec}`); run('riscv64-unknown-elf-objcopy', ['-O', 'binary', '-j', sec, elf, f]); return existsSync(f) ? new Uint8Array(readFileSync(f)) : new Uint8Array(0); };
  return { ok: true, text: sect('.text'), data: sect('.data') };
}

function check(name, source, { onKernel = false, limit = 200000, gnu = false } = {}) {
  let prog = N4.asm.assemble(source);
  if (!prog.ok && gnu) prog = gnuAssemble(source) || prog;
  if (!prog.ok) { checks++; fail(`${name}: does not assemble: line ${prog.errors[0].line}: ${prog.errors[0].message}`); return; }
  const pkg = programPackage(prog);
  const model = modelRun(prog, pkg, limit);
  if (!model.halted) { checks++; fail(`${name}: the model did not stop within ${limit} instructions`); return; }
  const stopNs = 10 * (model.cycles + 10) + 20;
  const g = coreOnGhdl(pkg, stopNs);
  if (!compareCommits(name, g, model, 'GHDL')) return;
  let note = `${model.lines.length} commits, ${model.cycles} cycles, as predicted`;
  if (onKernel) {
    const t0 = Date.now();
    const k = coreOnKernel(pkg, stopNs);
    if (!compareCommits(name, k, model, 'NEXUS-4 kernel')) return;
    note += `; NEXUS-4 kernel too (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
  }
  console.log(`ok    ${name}: ${note}`);
}

// 1. the programs
const progs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.s')).sort().map((f) => [f, read(join(dir, f))]) : []);
for (const [f, src] of [...progs(join(ROOT, 'tests', 'core')), ...progs(join(ROOT, 'tests', 'isa'))]) check(f, src, { onKernel: true });

// 2. smoke.s on the kernel against GHDL, delta cycle by delta cycle
{
  checks++;
  const prog = N4.asm.assemble(read(join(ROOT, 'tests', 'core', 'smoke.s')));
  const pkg = programPackage(prog);
  const model = modelRun(prog, pkg, 1000);
  const stop = 10 * (model.cycles + 10) + 20;
  const file = join(work, 'core_delta.vhd');
  writeFileSync(file, `-- @top: tb_nexus4\n-- @stop: ${stop}ns\n${designSource(pkg)}`);
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
