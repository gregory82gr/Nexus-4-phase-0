#!/usr/bin/env node
// Checks the NEXUS-4 ISA reference model against Spike, the RISC-V reference simulator, instruction by instruction.
// - every tests/isa/*.s program: the same commits (pc, instruction word, register written and its value,
//   memory address and stored value) up to the program's write to tohost;
// - random programs (fixed seeds, or NEXUS4_SEED; NEXUS4_FUZZ instructions each): the same;
// - every case in tests/isa/traps.txt: both stop at the same instruction with the same cause and tval;
// - every case in tests/isa/differences.txt: Spike runs it, NEXUS-4 stops on purpose (the list stays true).
//
// Programs are assembled and linked by GNU binutils where Spike expects memory: .text at 0x80000000,
// .data at 0x80010000, each a 64 KiB region. The model gets the same bytes at the same addresses, so the
// model is checked on its own, not through the NEXUS-4 assembler.
// Needs riscv64-unknown-elf-as/-ld/-objcopy/-nm and Spike (SPIKE=/path/to/spike, default: spike on PATH).

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const DIR = join(ROOT, 'tests', 'isa');
const BIN = 'riscv64-unknown-elf-';
const SPIKE = process.env.SPIKE || 'spike';
const TEXT = 0x80000000, DATA = 0x80010000, SIZE = 0x10000;

export function loadModel(index = INDEX) {
  const html = readFileSync(index, 'utf8');
  const open = '<script id="nexus4-isa">';
  const a = html.indexOf(open);
  if (a < 0) throw new Error('index.html has no <script id="nexus4-isa">');
  const sb = { console };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(html.slice(a + open.length, html.indexOf('</script>', a)), sb, { filename: 'isa.js' });
  return sb.NEXUS4.isa;
}
const isa = loadModel();
const work = mkdtempSync(join(tmpdir(), 'nexus4-isa-'));
const LD = join(work, 'link.ld');
writeFileSync(LD, `SECTIONS { . = 0x${TEXT.toString(16)}; .text : { *(.text) *(.text.*) } . = 0x${DATA.toString(16)}; .data : { *(.data) *(.rodata) *(.bss) } }\n`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.error) throw new Error(`cannot run ${cmd}: ${r.error.message}`);
  return r;
}
const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

/** Assemble and link with GNU at Spike's addresses: { elf, text, data, symbols } or { error }. */
function build(source, name) {
  const s = join(work, `${name}.s`), o = join(work, `${name}.o`), elf = join(work, `${name}.elf`);
  writeFileSync(s, source);
  const as = run(`${BIN}as`, ['-march=rv32i_zicsr_zifencei', '-mabi=ilp32', '-mno-relax', '-o', o, s]);
  if (as.status !== 0) return { error: as.stderr };
  const ld = run(`${BIN}ld`, ['-m', 'elf32lriscv', '-T', LD, '-o', elf, o]);
  if (ld.status !== 0) return { error: ld.stderr };
  const sect = (sec) => {
    const out = join(work, `${name}.${sec.slice(1)}.bin`);
    run(`${BIN}objcopy`, ['-O', 'binary', '-j', sec, elf, out]);
    return existsSync(out) ? new Uint8Array(readFileSync(out)) : new Uint8Array(0);
  };
  const symbols = {};
  for (const line of run(`${BIN}nm`, [elf]).stdout.split('\n')) {
    const m = /^([0-9a-f]+) \w (\S+)$/.exec(line.trim());
    if (m) symbols[m[2]] = parseInt(m[1], 16);
  }
  return { elf, text: sect('.text'), data: sect('.data'), symbols };
}

const SPIKE_ARGS = ['--isa=rv32i', '--priv=m', `-m0x${TEXT.toString(16)}:0x${SIZE.toString(16)},0x${DATA.toString(16)}:0x${SIZE.toString(16)}`];

/** Spike's commits from the program's first instruction on (the boot ROM before it is left out). */
function spikeCommits(elf, limit) {
  const r = run(SPIKE, [...SPIKE_ARGS, '--log-commits', `--instructions=${limit}`, elf], { timeout: 120000 });
  const out = [];
  for (const line of (r.stderr + r.stdout).split('\n')) {
    const m = /^core\s+0: \d (0x[0-9a-f]+) \((0x[0-9a-f]+)\)(.*)$/.exec(line);
    if (!m) continue;
    const pc = parseInt(m[1], 16);
    if (pc < TEXT) continue;
    const c = { pc, insn: parseInt(m[2], 16) };
    const rest = m[3];
    const x = /\bx(\d+)\s+(0x[0-9a-f]+)/.exec(rest);
    if (x && Number(x[1]) !== 0) { c.rd = Number(x[1]); c.wdata = parseInt(x[2], 16) >>> 0; }
    const mm = /\bmem (0x[0-9a-f]+)(?: (0x[0-9a-f]+))?/.exec(rest);
    if (mm) { c.addr = parseInt(mm[1], 16) >>> 0; if (mm[2] !== undefined) c.store = parseInt(mm[2], 16) >>> 0; }
    out.push(c);
  }
  return out;
}

const TRAP_NAMES = {
  trap_instruction_address_misaligned: 0, trap_instruction_access_fault: 1, trap_illegal_instruction: 2,
  trap_breakpoint: 3, trap_load_address_misaligned: 4, trap_load_access_fault: 5,
  trap_store_address_misaligned: 6, trap_store_access_fault: 7, trap_machine_ecall: 11
};
/** Spike's first trap in the program: { cause, epc, tval } or null. */
function spikeTrap(elf, limit = 2000) {
  const r = run(SPIKE, [...SPIKE_ARGS, '-l', `--instructions=${limit}`, elf], { timeout: 60000 });
  const lines = (r.stderr + r.stdout).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /exception (\w+), epc (0x[0-9a-f]+)/.exec(lines[i]);
    if (!m) continue;
    const t = /tval (0x[0-9a-f]+)/.exec(lines[i + 1] || '');
    return { cause: TRAP_NAMES[m[1]] ?? m[1], epc: parseInt(m[2], 16) >>> 0, tval: t ? parseInt(t[1], 16) >>> 0 : 0 };
  }
  return null;
}

function newMachine(b) {
  const m = new isa.Machine({ imem: { base: TEXT, size: SIZE }, dmem: { base: DATA, size: SIZE } });
  m.load(b, TEXT, DATA);
  return m;
}

let checks = 0, failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };

/** Run a terminating program on both and compare every commit up to the store to tohost. */
function compare(name, source, limit = 200000) {
  checks++;
  const b = build(source, name.replace(/\W+/g, '_'));
  if (b.error) { fail(`${name}: GNU as rejects it: ${b.error.split('\n').find((l) => /Error/.test(l))}`); return; }
  const tohost = b.symbols.tohost;
  if (tohost === undefined) { fail(`${name}: no tohost symbol`); return; }
  let sp = spikeCommits(b.elf, limit);
  const end = sp.findIndex((c) => c.store !== undefined && c.addr === tohost);
  if (end < 0) { fail(`${name}: Spike did not write tohost within ${limit} instructions`); return; }
  sp = sp.slice(0, end + 1);
  const m = newMachine(b);
  for (let i = 0; i < sp.length; i++) {
    const s = sp[i], r = m.step();
    const where = `${name}: commit ${i} at ${hex(s.pc)}`;
    if (r.trap) { fail(`${where}: NEXUS-4 stops with ${r.trap.text} (tval ${hex(r.trap.tval)}); Spike executes ${hex(s.insn)}`); return; }
    const diffs = [];
    if (r.pc !== s.pc) diffs.push(`pc ${hex(r.pc)} / ${hex(s.pc)}`);
    if (r.insn !== s.insn) diffs.push(`instruction ${hex(r.insn)} / ${hex(s.insn)}`);
    if (r.rd !== s.rd || r.wdata !== s.wdata) diffs.push(`writes ${r.rd === undefined ? 'nothing' : `x${r.rd} = ${hex(r.wdata)}`} / ${s.rd === undefined ? 'nothing' : `x${s.rd} = ${hex(s.wdata)}`}`);
    const ra = r.mem ? r.mem.addr : undefined;
    if (ra !== s.addr) diffs.push(`memory address ${ra === undefined ? 'none' : hex(ra)} / ${s.addr === undefined ? 'none' : hex(s.addr)}`);
    else if (s.store !== undefined && (!r.mem.store || r.mem.data !== s.store)) diffs.push(`stores ${r.mem.store ? hex(r.mem.data) : 'nothing'} / ${hex(s.store)}`);
    if (diffs.length) { fail(`${where} (NEXUS-4 / Spike): ${diffs.join('; ')}`); return; }
  }
  console.log(`ok    ${name} (${sp.length} instructions)`);
  return sp.length;
}

// 1. the programs in tests/isa
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.s')).sort()) compare(f, readFileSync(join(DIR, f), 'utf8'));

// 2. traps: the same cause at the same instruction with the same tval
const PRE = '  .text\n  .globl _start\n_start:\n  nop\n';
const POST = '\n  nop\n  .data\nbuf: .word 0x11223344, 0x55667788\n  .align 3\ntohost: .word 0, 0\n';
const cases = (file) => readFileSync(join(DIR, file), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
for (const line of cases('traps.txt')) {
  checks++;
  const b = build(PRE + line.replace(/\\n/g, '\n') + POST, `trap${checks}`);
  if (b.error) { fail(`trap case "${line}": GNU as rejects it`); continue; }
  const s = spikeTrap(b.elf);
  const m = newMachine(b);
  const r = m.run(2000).halted;
  if (!s) { fail(`trap case "${line}": Spike does not trap`); continue; }
  if (!r) { fail(`trap case "${line}": NEXUS-4 does not stop`); continue; }
  if (r.trap.cause !== s.cause || r.pc !== s.epc || r.trap.tval !== s.tval) {
    fail(`trap case "${line}": NEXUS-4 cause ${r.trap.cause} at ${hex(r.pc)} tval ${hex(r.trap.tval)}, Spike cause ${s.cause} at ${hex(s.epc)} tval ${hex(s.tval)}`);
    continue;
  }
  console.log(`ok    trap: ${line}  (${r.trap.text})`);
}

// 3. the deliberate differences: Spike runs the instruction, NEXUS-4 stops
for (const line of cases('differences.txt')) {
  checks++;
  const [code, expect] = line.split(/\s+=>\s+/);
  const b = build(PRE + code.replace(/\\n/g, '\n') + POST, `diff${checks}`);
  if (b.error) { fail(`difference "${code}": GNU as rejects it`); continue; }
  const s = spikeTrap(b.elf, 40);
  const r = newMachine(b).run(40).halted;
  // the case's own instructions lie between the leading and the trailing nop; the last one must be where
  // NEXUS-4 stops (not some later word past the end of the program)
  const last = TEXT + b.text.length - 8;
  if (s && s.epc >= TEXT + 4 && s.epc <= last) { fail(`difference "${code}": Spike traps too (cause ${s.cause}); move it to traps.txt`); continue; }
  // (a fetch fault is reported at the address fetched, which the case jumped to)
  const where = r && (r.trap.cause === 1 ? r.pc === r.trap.tval && (r.pc < TEXT || r.pc >= TEXT + b.text.length) : r.pc === last);
  if (!r || String(r.trap.cause) !== expect.trim() || !where) { fail(`difference "${code}": NEXUS-4 ${r ? `stops with cause ${r.trap.cause} at ${hex(r.pc)}` : 'does not stop'}, expected cause ${expect.trim()} at ${hex(last)}`); continue; }
  console.log(`ok    stricter than Spike: ${code}  (${r.trap.text})`);
}

// 4. random programs that end: straight code, forward branches and jumps, short counted loops,
//    loads and stores inside a data buffer at s0. s0 and s1 (loop counter) are never written by the body.
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let rnd;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const RD = () => pick(['x0', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6']);
const RS = () => (rnd() < 0.1 ? pick(['x0', 's0']) : RD());
const IMM = () => pick([int(-2048, 2047), -2048, 2047, 0, -1, 1, int(-16, 16)]);
const VAL = () => pick([int(-2147483648, 2147483647), 0, -1, 1, 0x7fffffff, -2147483648, int(-100, 100), 0x80000000 >>> 0, 0xffff, 0xff]);

function randomProgram(n) {
  const L = ['  .text', '  .globl _start', '_start:', '  la s0, buf'];
  for (const r of ['ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6']) L.push(`  li ${r}, ${VAL()}`);
  let label = 0, inLoop = 0;
  const one = () => {
    const k = int(0, 13);
    if (k <= 2) return `  ${pick(['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'])} ${RD()}, ${RS()}, ${RS()}`;
    if (k <= 4) return `  ${pick(['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi'])} ${RD()}, ${RS()}, ${IMM()}`;
    if (k === 5) return `  ${pick(['slli', 'srli', 'srai'])} ${RD()}, ${RS()}, ${int(0, 31)}`;
    if (k === 6) return `  ${pick(['lui', 'auipc'])} ${RD()}, ${int(0, 0xfffff)}`;
    if (k === 7) { const [op, sz] = pick([['lw', 4], ['lh', 2], ['lhu', 2], ['lb', 1], ['lbu', 1]]); return `  ${op} ${RD()}, ${int(0, 1000) * sz % 2040}(s0)`; }
    if (k === 8) { const [op, sz] = pick([['sw', 4], ['sh', 2], ['sb', 1]]); return `  ${op} ${RS()}, ${int(0, 1000) * sz % 2040}(s0)`; }
    if (k === 9) return pick(['  nop', '  fence', '  fence rw, rw', '  fence i, o']);
    return null;   // control flow, below
  };
  for (let i = 0; i < n; i++) {
    const s = one();
    if (s) { L.push(s); continue; }
    const k = int(0, 4);
    if (k === 0 || k === 1) {         // a forward branch over 0..3 instructions
      const l = `F${label++}`;
      L.push(`  ${pick(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'])} ${RS()}, ${RS()}, ${l}`);
      for (let j = int(0, 3); j > 0; j--) L.push(one() || '  nop');
      L.push(`${l}:`);
    } else if (k === 2) {             // jal forward, with or without a link
      const l = `F${label++}`;
      L.push(`  jal ${RD()}, ${l}`);
      for (let j = int(0, 2); j > 0; j--) L.push(one() || '  nop');
      L.push(`${l}:`);
    } else if (k === 3) {             // jalr through an auipc: target = that pc + 8 + 4*skip
      const t = pick(['t0', 't1', 'a5', 's2']), skip = int(0, 2), link = RD();
      L.push(`  auipc ${t}, 0`, `  jalr ${link}, ${8 + 4 * skip}(${t})`);
      for (let j = 0; j < skip; j++) L.push('  nop');
    } else if (!inLoop) {             // a counted loop of a few instructions
      inLoop = 1;
      const l = `B${label++}`;
      L.push(`  li s1, ${int(1, 6)}`, `${l}:`);
      for (let j = int(1, 6); j > 0; j--) L.push(one() || '  addi a0, a0, 1');
      L.push('  addi s1, s1, -1', `  bnez s1, ${l}`);
      inLoop = 0;
    }
  }
  L.push('  la t0, tohost', '  li t1, 1', '  sw t1, 0(t0)', '1: j 1b', '  .data', 'buf:');
  for (let i = 0; i < 512; i++) L.push(`  .word ${VAL()}`);
  L.push('  .align 3', 'tohost: .word 0, 0', '');
  return L.join('\n');
}

const SEEDS = (process.env.NEXUS4_SEED || '4004,1,2').split(',').map(Number);
const N = Number(process.env.NEXUS4_FUZZ || 3000);
for (const seed of SEEDS) {
  rnd = prng(seed);
  const src = randomProgram(N);
  if (process.env.NEXUS4_DUMP) writeFileSync(process.env.NEXUS4_DUMP, src);
  compare(`random program (seed ${seed}, ${N} statements)`, src);
}

console.log(`\n${checks} ISA model checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
