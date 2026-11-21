#!/usr/bin/env node
// Checks the NEXUS-4 assembler and disassembler against GNU binutils for RISC-V.
// - every tests/asm/*.s, tests/isa/*.s and tests/core/*.s: identical .text and .data bytes, and identical symbol addresses;
// - every line of tests/asm/errors.txt: rejected by both;
// - every line of tests/asm/stricter.txt: accepted by GNU, rejected by NEXUS-4 on purpose (the list stays true);
// - a random program of a few thousand instructions (fixed seed, or NEXUS4_SEED): identical bytes,
//   and the disassembler prints what objdump -M no-aliases,numeric prints, line by line.
// Needs riscv64-unknown-elf-as, -ld, -objcopy, -objdump and -nm (Ubuntu: binutils-riscv64-unknown-elf).

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const DIR = join(ROOT, 'tests', 'asm');
const BIN = 'riscv64-unknown-elf-';

function loadAsm() {
  const html = readFileSync(INDEX, 'utf8');
  const open = '<script id="nexus4-asm">';
  const a = html.indexOf(open);
  if (a < 0) throw new Error('index.html has no <script id="nexus4-asm">');
  const src = html.slice(a + open.length, html.indexOf('</script>', a));
  const sb = { console };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'asm.js' });
  return sb.NEXUS4.asm;
}
const asm = loadAsm();
const work = mkdtempSync(join(tmpdir(), 'nexus4-asm-'));
const LD = join(work, 'link.ld');
writeFileSync(LD, `SECTIONS { . = 0x${asm.TEXT_BASE.toString(16)}; .text : { *(.text) } . = 0x${asm.DATA_BASE.toString(16)}; .data : { *(.data) *(.rodata) *(.bss) } }\n`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw new Error(`cannot run ${cmd}: ${r.error.message}`);
  return r;
}

/** GNU's view of a source: bytes of .text and .data, symbols; or its error output. */
function gnu(source, name) {
  const s = join(work, `${name}.s`), o = join(work, `${name}.o`), elf = join(work, `${name}.elf`);
  writeFileSync(s, source);
  const as = run(`${BIN}as`, ['-march=rv32i', '-mabi=ilp32', '-mno-relax', '-o', o, s]);
  if (as.status !== 0) return { ok: false, stderr: as.stderr };
  const ld = run(`${BIN}ld`, ['-m', 'elf32lriscv', '-T', LD, '-o', elf, o]);
  if (ld.status !== 0) return { ok: false, stderr: ld.stderr };
  const sect = (sec) => {
    const out = join(work, `${name}.${sec.slice(1)}.bin`);
    run(`${BIN}objcopy`, ['-O', 'binary', '-j', sec, elf, out]);
    return existsSync(out) ? new Uint8Array(readFileSync(out)) : new Uint8Array(0);
  };
  const symbols = {};
  for (const line of run(`${BIN}nm`, [elf]).stdout.split('\n')) {
    const m = /^([0-9a-f]+) (\w) (\S+)$/.exec(line.trim());
    if (m && !m[3].startsWith('$') && !m[3].startsWith('.L')) symbols[m[3]] = { value: parseInt(m[1], 16), kind: m[2] };
  }
  return { ok: true, text: sect('.text'), data: sect('.data'), symbols, elf, warnings: as.stderr };
}

const hexb = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

let failures = 0, checks = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

function compare(name, source) {
  checks++;
  const ours = asm.assemble(source);
  const g = gnu(source, name.replace(/\W/g, '_'));
  if (!g.ok) { fail(`${name}: GNU as rejects it:\n${g.stderr}`); return null; }
  if (!ours.ok) { fail(`${name}: NEXUS-4 rejects it: ${ours.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`); return null; }
  let ok = true;
  for (const sec of ['text', 'data']) {
    const a = ours[sec], b = g[sec];
    const i = firstDiff(a, b);
    if (i >= 0) {
      ok = false;
      const w = i - (i % 4);
      const at = (sec === 'text' ? ours.textBase : ours.dataBase) + w;
      const src = ours.listing.find((l) => at >= l.addr && at < l.addr + (l.words ? l.words.length * 4 : l.bytes));
      fail(`${name}: .${sec} differs at offset 0x${i.toString(16)} (NEXUS-4 ${hexb(a.slice(w, w + 4))}, GNU ${hexb(b.slice(w, w + 4))}; lengths ${a.length} and ${b.length})` +
        (src ? `\n      source line ${src.line}: ${src.src.trim()}` : ''));
    }
  }
  let symFails = 0;
  for (const [k, v] of Object.entries(ours.symbols)) {
    if (v.section === 'abs') continue;
    if (symFails >= 3) { ok = false; continue; }
    if (!g.symbols[k]) { ok = false; fail(`${name}: symbol ${k} is missing in GNU's table`); continue; }
    if (g.symbols[k].value !== v.value) { ok = false; symFails++; fail(`${name}: symbol ${k} is 0x${v.value.toString(16)}, GNU says 0x${g.symbols[k].value.toString(16)}`); }
  }
  if (ok) console.log(`ok    ${name} (${ours.text.length} bytes of text, ${ours.data.length} of data)`);
  return { ours, g };
}

// 1. the corpus
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.s')).sort()) compare(f, readFileSync(join(DIR, f), 'utf8'));
// the programs of the ISA model and core checks are assembler programs too (the Assembler page offers them)
for (const d of ['isa', 'core']) {
  const dir = join(ROOT, 'tests', d);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.s')).sort()) compare(`${d}/${f}`, readFileSync(join(dir, f), 'utf8'));
}

// 2. errors: both must reject each line
const errLines = readFileSync(join(DIR, 'errors.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
errLines.forEach((line, i) => {
  checks++;
  const src = `  .text\n${line.replace(/\\n/g, "\n")}\n`;   // \n starts a new line, as in stricter.txt
  const ours = asm.assemble(src);
  const g = gnu(src, `err${i}`);
  if (g.ok) fail(`error case "${line}": GNU as accepts it`);
  else if (ours.ok) fail(`error case "${line}": NEXUS-4 accepts it (GNU: ${g.stderr.split('\n').find((l) => /Error/.test(l)) || g.stderr.trim()})`);
  else console.log(`ok    rejected: ${line}  (${ours.errors[0].message})`);
});

// the deliberate differences: GNU accepts, NEXUS-4 rejects. Whatever both accept is byte-identical.
const strictLines = readFileSync(join(DIR, 'stricter.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
strictLines.forEach((line, i) => {
  checks++;
  const src = `  .text\n${line.replace(/\\n/g, '\n')}\n`;
  const ours = asm.assemble(src);
  const g = gnu(src, `strict${i}`);
  if (!g.ok) fail(`stricter case "${line}": GNU as rejects it too; move it to errors.txt`);
  else if (ours.ok) fail(`stricter case "${line}": NEXUS-4 accepts it`);
  else console.log(`ok    stricter than GNU: ${line}  (${ours.errors[0].message})`);
});

// 3. a random program, and the disassembler against objdump
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SEEDS = (process.env.NEXUS4_SEED || '4004,1,2').split(',').map(Number);
let rnd;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const REG = () => pick([`x${int(0, 31)}`, ...['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 'fp', 's1', 'a0', 'a1', 'a7', 's2', 's11', 't3', 't6']]);
const NZ = () => { let r; do r = REG(); while (r === 'x0' || r === 'zero'); return r; };   // GNU rejects x0 for la and lw-with-symbol
const IMM = () => pick([int(-2048, 2047), -2048, 2047, 0, -1, int(-20, 20)]);
const N = Number(process.env.NEXUS4_FUZZ || 3000);
for (const seed of SEEDS) {
rnd = prng(seed);
const lines = ['  .text', 'L0:'];
let labels = 1;
for (let i = 0; i < N; i++) {
  if (i % 40 === 0) lines.push(`L${labels++}:`);
  const near = () => `L${Math.max(0, Math.min(labels + int(-2, 2), labels + 1))}`;
  const k = int(0, 15);
  if (k === 0) lines.push(`  ${pick(['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'])} ${REG()}, ${REG()}, ${REG()}`);
  else if (k === 1) lines.push(`  ${pick(['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi'])} ${REG()}, ${REG()}, ${IMM()}`);
  else if (k === 2) lines.push(`  ${pick(['slli', 'srli', 'srai'])} ${REG()}, ${REG()}, ${int(0, 31)}`);
  else if (k === 3) lines.push(`  ${pick(['lb', 'lh', 'lw', 'lbu', 'lhu'])} ${REG()}, ${IMM()}(${REG()})`);
  else if (k === 4) lines.push(`  ${pick(['sb', 'sh', 'sw'])} ${REG()}, ${IMM()}(${REG()})`);
  else if (k === 5) lines.push(`  ${pick(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'bgt', 'ble', 'bgtu', 'bleu'])} ${REG()}, ${REG()}, ${near()}`);
  else if (k === 6) lines.push(`  ${pick(['beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz'])} ${REG()}, ${near()}`);
  else if (k === 7) lines.push(`  ${pick(['lui', 'auipc'])} ${REG()}, ${int(0, 0xfffff)}`);
  else if (k === 8) lines.push(pick([`  jal ${REG()}, ${near()}`, `  j ${near()}`, `  jal ${near()}`, `  jalr ${REG()}, ${IMM()}(${REG()})`, `  jr ${REG()}`, '  ret',
    `  jr ${REG()}, ${IMM()}`, `  jr ${IMM()}(${REG()})`, `  jalr ${REG()}, ${IMM()}`, `  jalr ${REG()}, ${REG()}`, `  jalr ${REG()}, ${REG()}, ${IMM()}`, `  call ${REG()}, ${near()}`, `  jump ${near()}, ${NZ()}`]));
  else if (k === 9) lines.push(`  li ${REG()}, ${pick([IMM(), int(-2147483648, 2147483647), int(0, 0xffffffff), int(1, 0xfffff) * 4096, 0x800, -2049])}`);
  else if (k === 10) lines.push(`  ${pick(['mv', 'not', 'neg', 'seqz', 'snez', 'sltz', 'sgtz'])} ${REG()}, ${REG()}`);
  else if (k === 11) lines.push(pick(['  nop', '  ecall', '  ebreak', '  fence', `  fence ${pick(['r', 'w', 'rw', 'iorw', 'io'])}, ${pick(['r', 'w', 'rw', 'iorw', 'o'])}`]));
  else if (k === 12) lines.push(`  ${pick(['la', 'lla'])} ${NZ()}, ${pick(['D0', 'D1', 'D2'])} + ${int(0, 16)}`);
  else if (k === 13) lines.push(`  ${pick(['call', 'tail'])} ${near()}`);
  else if (k === 14) lines.push(`  ${pick(['lw', 'lbu', 'lh'])} ${NZ()}, ${pick(['D0', 'D1', 'D2'])}`);
  else lines.push(`  ${pick(['sw', 'sb', 'sh'])} ${REG()}, ${pick(['D0', 'D1', 'D2'])}, ${pick(['t0', 't1', 'a5', 's3'])}`);
}
lines.push(`L${labels}:`, `L${labels + 1}:`, '  nop', '  .data', 'D0: .word 1, 2, 3', 'D1: .half 4, 5', 'D2: .byte 6, 7, 8', '');

// random constant expressions: GNU evaluates them in 64 bits, and li and the data directives see
// all 64; li never rejects a constant, so every line here must assemble
{
  const big = () => pick([
    `0x${Array.from({ length: int(1, 16) }, () => '0123456789abcdef'[int(0, 15)]).join('')}`,
    String(int(-5000, 5000)), String(int(0, 0xffffffff)), '0xffffffffffffffff', '0x8000000000000000', '0x100000000', '0xffffffff',
    `0${int(0, 0o777)}`.replace(/^0(\d+)$/, (_, d) => `0${Number(d).toString(8)}`), `'${pick(['a', 'Z', '0'])}'`, 'K1', 'K2']);
  const ex = (d) => {
    if (d > 2 || rnd() < 0.35) return big();
    const op = pick(['+', '-', '*', '/', '%', '<<', '>>', '&', '|', '^', 'u-', 'u~', 'u!']);
    if (op[0] === 'u') return `${op[1]}(${ex(d + 1)})`;
    if (op === '/' || op === '%') return `(${ex(d + 1)}) ${op} ${int(1, 300)}`;
    if (op === '<<' || op === '>>') return `(${ex(d + 1)}) ${op} ${int(0, 63)}`;
    // without parentheses too, so that precedence and associativity are compared (GNU's are not C's)
    if (rnd() < 0.5) {
      const op2 = pick(['+', '-', '*', '&', '|', '^', '<<', '>>']);
      const shift = (o) => o === '<<' || o === '>>';
      // a shift count must be 0..63 (NEXUS-4 refuses others, GNU warns), so shifts get small literal counts
      return `${big()} ${op} ${shift(op) ? int(0, 63) : big()} ${op2} ${shift(op2) ? int(0, 63) : pick(['1', '2', '3', '7', 'K1'])}`;
    }
    return `(${ex(d + 1)}) ${op} (${ex(d + 1)})`;
  };
  const xl = ['  .text', `  .equ K1, ${big().replace(/K\d/, '7')}`, `  .equ K2, 0xfffffffffffff800`];
  for (let i = 0; i < Math.max(50, N / 10); i++) xl.push(`  li ${REG()}, ${ex(0)}`);
  xl.push('  addi a0, a0, K2', '  addi a0, a0, 0xfffff800', '  andi a1, a2, (0xffffffffffffffff >> 53)', '  .data');
  for (let i = 0; i < Math.max(30, N / 30); i++) xl.push(`  ${pick(['.word', '.half', '.byte'])} ${ex(0)}`);
  xl.push('');
  compare(`random constant expressions (seed ${seed})`, xl.join('\n'));
}
if (process.env.NEXUS4_DUMP) writeFileSync(process.env.NEXUS4_DUMP, lines.join('\n'));
const fuzz = compare(`random program (seed ${seed}, ${N} lines)`, lines.join('\n'));

if (fuzz) {
  checks++;
  const dump = run(`${BIN}objdump`, ['-d', '-M', 'no-aliases,numeric', fuzz.g.elf]).stdout.split('\n');
  let bad = 0, n = 0;
  for (const l of dump) {
    const m = /^\s*([0-9a-f]+):\s+([0-9a-f]{8})\s+(.*)$/.exec(l);
    if (!m) continue;
    n++;
    const want = m[3].replace(/\s*<[^>]*>/, '').replace(/\s*#.*$/, '').trim().replace(/\s+/g, ' ');
    const got = asm.disassemble(parseInt(m[2], 16), parseInt(m[1], 16)).text.replace(/\s+/g, ' ');
    if (got !== want) { if (bad++ < 10) fail(`disassembly of ${m[2]} at 0x${m[1]}: NEXUS-4 "${got}", objdump "${want}"`); }
  }
  if (!bad) console.log(`ok    disassembler matches objdump on ${n} instructions`);
  else fail(`${bad} of ${n} disassembled instructions differ`);
}

}

console.log(`\n${checks} assembler checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
