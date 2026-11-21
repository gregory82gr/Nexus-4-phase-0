#!/usr/bin/env node
// Checks the NEXUS-4 ISA reference model against Spike, the RISC-V reference simulator, instruction by instruction.
// - every tests/isa/*.s program: the same commits (pc, instruction word, register written and its value,
//   memory address and stored value) up to the program's write to tohost;
// - random programs (fixed seeds, or NEXUS4_SEED; NEXUS4_FUZZ instructions each): the same;
// - every case in tests/isa/traps.txt: both stop at the same instruction with the same cause and tval;
// - every case in tests/isa/differences.txt: Spike runs it, NEXUS-4 stops on purpose (the list stays true);
// - every case in tests/isa/extensions.txt: NEXUS-4 runs it (the guardian's marker, D58), Spike stops.
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
import { randomProgram } from './isa-random.mjs';

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
// GNU as has no name for NEXUS-4's marker (D58); this macro gives it one, as the same .insn
const GNU_PRELUDE = '.macro nx.mark a, b\n.ifb \\b\n.insn i 0x0b, 0, x0, x0, \\a\n.else\n.insn i 0x0b, 0, x0, \\a, \\b\n.endif\n.endm\n';
function build(source, name) {
  const s = join(work, `${name}.s`), o = join(work, `${name}.o`), elf = join(work, `${name}.elf`);
  writeFileSync(s, GNU_PRELUDE + source);
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

// 3b. NEXUS-4's extensions: Spike stops on them (it knows only standard RISC-V), NEXUS-4 runs them
for (const line of cases('extensions.txt')) {
  checks++;
  const [code, expect] = line.split(/\s+=>\s+/);
  const b = build(PRE + code.replace(/\\n/g, '\n') + POST, `ext${checks}`);
  if (b.error) { fail(`extension "${code}": GNU as rejects it`); continue; }
  const s = spikeTrap(b.elf, 40);
  const last = TEXT + b.text.length - 8;
  const m = newMachine(b);
  let r = null;
  for (let i = 0; i < 40 && !r; i++) { const x = m.step(); if (x.trap) r = x; if (x.pc === last) break; }
  if (!s || String(s.cause) !== expect.trim() || s.epc !== last) { fail(`extension "${code}": Spike ${s ? `stops with cause ${s.cause} at ${hex(s.epc)}` : 'does not stop'}, expected cause ${expect.trim()} at ${hex(last)}`); continue; }
  if (r) { fail(`extension "${code}": NEXUS-4 stops too (cause ${r.trap.cause} at ${hex(r.pc)})`); continue; }
  console.log(`ok    a NEXUS-4 extension Spike does not know: ${code}  (Spike: ${isa.CAUSE[s.cause]})`);
}

// 4. random programs that end (tools/isa-random.mjs)
const SEEDS = (process.env.NEXUS4_SEED || '4004,1,2').split(',').map(Number);
const N = Number(process.env.NEXUS4_FUZZ || 3000);
for (const seed of SEEDS) {
  const src = randomProgram(seed, N);
  if (process.env.NEXUS4_DUMP) writeFileSync(process.env.NEXUS4_DUMP, src);
  compare(`random program (seed ${seed}, ${N} statements)`, src);
}

console.log(`\n${checks} ISA model checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
