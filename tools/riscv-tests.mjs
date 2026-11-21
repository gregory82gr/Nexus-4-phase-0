#!/usr/bin/env node
// Runs the official RISC-V unprivileged tests for RV32I (riscv-tests, isa/rv32ui) on the NEXUS-4 tool chain:
//   1. the C preprocessor expands each test with the NEXUS-4 environment (tests/riscv-tests/riscv_test.h);
//   2. the NEXUS-4 assembler assembles it, and GNU as must produce the same bytes (a real-world corpus
//      for the assembler oracle);
//   3. the NEXUS-4 ISA reference model runs it; every case must pass (gp = 1 at the final ecall).
//
// riscv-tests are not copied into this repository: CI clones them at the commit below.
//   RISCV_TESTS=/path/to/riscv-tests node tools/riscv-tests.mjs
// Needs cpp and riscv64-unknown-elf-as/-ld/-objcopy.

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

export const RISCV_TESTS_COMMIT = '3df703cd52d5f0d8224e3c50bf03c6cb70efff98';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const TESTS = process.env.RISCV_TESTS || join(ROOT, 'third_party', 'riscv-tests');
const ENV = join(ROOT, 'tests', 'riscv-tests');
const BIN = 'riscv64-unknown-elf-';

// Left out, with the reason. Everything else in isa/rv32ui must pass.
const EXCLUDED = {
  'fence_i.S': 'fence.i belongs to the Zifencei extension; the NEXUS-4 core has fixed code in its instruction scratchpad',
  'ma_data.S': 'misaligned loads and stores trap on the NEXUS-4 core (a fail-safe stop); the test needs them to work or a trap handler'
};

function load() {
  const html = readFileSync(INDEX, 'utf8');
  const sb = { console };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const id of ['nexus4-asm', 'nexus4-isa']) {
    const open = `<script id="${id}">`;
    const a = html.indexOf(open);
    if (a < 0) throw new Error(`index.html has no <script id="${id}">`);
    vm.runInContext(html.slice(a + open.length, html.indexOf('</script>', a)), sb, { filename: `${id}.js` });
  }
  return sb.NEXUS4;
}
const N4 = load();
const work = mkdtempSync(join(tmpdir(), 'nexus4-rvtests-'));
const LD = join(work, 'link.ld');
writeFileSync(LD, `SECTIONS { . = 0x${N4.asm.TEXT_BASE.toString(16)}; .text : { *(.text) *(.text.*) } . = 0x${N4.asm.DATA_BASE.toString(16)}; .data : { *(.data) *(.rodata) *(.bss) } }\n`);
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.error) throw new Error(`cannot run ${cmd}: ${r.error.message}`); return r; };

function gnu(source, name) {
  const s = join(work, `${name}.s`), o = join(work, `${name}.o`), elf = join(work, `${name}.elf`);
  writeFileSync(s, source);
  const as = run(`${BIN}as`, ['-march=rv32i', '-mabi=ilp32', '-mno-relax', '-o', o, s]);
  if (as.status !== 0) return { error: as.stderr };
  const ld = run(`${BIN}ld`, ['-m', 'elf32lriscv', '-T', LD, '-o', elf, o]);
  if (ld.status !== 0) return { error: ld.stderr };
  const sect = (sec) => { const out = join(work, `${name}${sec}.bin`); run(`${BIN}objcopy`, ['-O', 'binary', '-j', sec, elf, out]); return existsSync(out) ? new Uint8Array(readFileSync(out)) : new Uint8Array(0); };
  return { text: sect('.text'), data: sect('.data') };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const dir = join(TESTS, 'isa', 'rv32ui');
if (!existsSync(dir)) { console.error(`riscv-tests not found at ${TESTS} (set RISCV_TESTS; commit ${RISCV_TESTS_COMMIT})`); process.exit(1); }
const head = run('git', ['-C', TESTS, 'rev-parse', 'HEAD']).stdout.trim();
if (head && head !== RISCV_TESTS_COMMIT) console.log(`note  riscv-tests at ${head}, calibrated for ${RISCV_TESTS_COMMIT}`);

let passed = 0, failed = 0, excluded = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.S')).sort()) {
  if (EXCLUDED[f]) { excluded++; console.log(`skip  ${f}: ${EXCLUDED[f]}`); continue; }
  const name = f.replace(/\.S$/, '');
  const cpp = run('cpp', ['-x', 'assembler-with-cpp', '-P', '-nostdinc', '-D__riscv_xlen=32', '-I', ENV, '-I', join(TESTS, 'isa', 'macros', 'scalar'), join(dir, f)]);
  if (cpp.status !== 0) { failed++; console.log(`FAIL  ${f}: cpp: ${cpp.stderr.trim().split('\n')[0]}`); continue; }
  const src = cpp.stdout;
  const ours = N4.asm.assemble(src);
  if (!ours.ok) { failed++; console.log(`FAIL  ${f}: NEXUS-4 assembler: line ${ours.errors[0].line}: ${ours.errors[0].message}\n      ${src.split('\n')[ours.errors[0].line - 1].trim().slice(0, 160)}`); continue; }
  const g = gnu(src, name);
  if (g.error) { failed++; console.log(`FAIL  ${f}: GNU as: ${g.error.split('\n').find((l) => /Error/.test(l))}`); continue; }
  if (!same(ours.text, g.text) || !same(ours.data, g.data)) { failed++; console.log(`FAIL  ${f}: the NEXUS-4 assembler and GNU as produce different bytes`); continue; }
  const m = new N4.isa.Machine();
  m.load(ours);
  const r = m.run(1000000);
  const h = r.halted;
  if (!h) { failed++; console.log(`FAIL  ${f}: no ecall within 1,000,000 instructions`); continue; }
  if (h.trap.cause !== 11) { failed++; console.log(`FAIL  ${f}: stopped by ${h.trap.text} at 0x${h.pc.toString(16)} (tval 0x${h.trap.tval.toString(16)})`); continue; }
  const gp = m.reg(3);
  if (gp !== 1) { failed++; console.log(`FAIL  ${f}: case ${gp >>> 1} failed`); continue; }
  passed++;
  console.log(`ok    ${f} (${r.steps} instructions, ${ours.text.length} bytes identical to GNU)`);
}
console.log(`\nriscv-tests rv32ui: ${passed} passed, ${failed} failed, ${excluded} left out (reasons above).`);
process.exit(failed ? 1 : 0);
