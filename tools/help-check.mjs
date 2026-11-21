#!/usr/bin/env node
// Checks the assembly Help (<script id="nexus4-help"> in index.html) against the tools it describes:
//   - the reference lists exactly the 40 instructions of RV32I;
//   - each entry's format, opcode, funct3 and funct7 are what the NEXUS-4 assembler produces for its syntax
//     line, and the disassembler reads the word back as the same instruction (the assembler itself is
//     checked against GNU binutils by tools/asm-check.mjs);
//   - each entry's cycle count is the core's: 4 for a load, 3 otherwise (tools/core-check.mjs checks the core);
//   - every example and idiom assembles and, run on the ISA reference model, ends as stated with the
//     register values stated (the model is checked against Spike; tools/core-check.mjs also runs these
//     programs on the VHDL core);
//   - every pseudo-instruction line and directive example assembles;
//   - every message example really makes the assembler complain;
//   - the trap causes are the model's;
//   - the lists of deliberate differences are the test files that prove them.
// Nothing in the Help is a number the reader has to take on trust.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');

export function loadNexus(index = INDEX) {
  const html = readFileSync(index, 'utf8');
  const sb = { console };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const id of ['nexus4-asm', 'nexus4-isa', 'nexus4-help']) {
    const open = `<script id="${id}">`;
    const a = html.indexOf(open);
    if (a < 0) throw new Error(`index.html has no <script id="${id}">`);
    vm.runInContext(html.slice(a + open.length, html.indexOf('</script>', a)), sb, { filename: `${id}.js` });
  }
  return sb.NEXUS4;
}

/** Runs a Help program on the model: { ok, problems, machine, result, steps }. */
export function runHelpProgram(N4, src, { expect = {}, stop = 11, ends = false } = {}) {
  const problems = [];
  const prog = N4.asm.assemble(N4.help.program(src, ends));
  if (!prog.ok) return { ok: false, problems: [`does not assemble: line ${prog.errors[0].line}: ${prog.errors[0].message}`] };
  const m = new N4.isa.Machine();
  m.load(prog);
  const r = m.run(200000);
  if (!r.halted) problems.push('does not end within 200,000 instructions');
  else if (r.halted.trap.cause !== stop) problems.push(`ends with cause ${r.halted.trap.cause} (${r.halted.trap.text}), not ${stop}`);
  const R = N4.isa.registers;
  for (const [reg, want] of Object.entries(expect)) {
    const i = R.indexOf(reg);
    if (i < 0) { problems.push(`no register ${reg}`); continue; }
    let w = want;
    if (typeof want === 'string' && want.startsWith('@')) {
      const s = prog.symbols[want.slice(1)];
      if (!s) { problems.push(`no label ${want.slice(1)}`); continue; }
      w = s.value;
    }
    if ((m.reg(i) >>> 0) !== (w >>> 0)) problems.push(`${reg} is 0x${(m.reg(i) >>> 0).toString(16)}, the Help says 0x${(w >>> 0).toString(16)}`);
  }
  return { ok: !problems.length, problems, machine: m, result: r, prog };
}

const RV32I = ['lui', 'auipc', 'jal', 'jalr', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw',
  'addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai', 'add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
  'fence', 'ecall', 'ebreak'];

function main() {
  const N4 = loadNexus();
  const H = N4.help, A = N4.asm;
  let checks = 0, failures = 0;
  const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
  const ok = (m) => console.log(`ok    ${m}`);

  // the set of instructions
  checks++;
  const names = H.instructions.map((x) => x.n);
  const missing = RV32I.filter((n) => !names.includes(n)), extra = names.filter((n) => !RV32I.includes(n));
  if (missing.length || extra.length || names.length !== 40) fail(`the reference lists ${names.length} instructions; missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}`);
  else ok('the reference lists the 40 instructions of RV32I, each once');

  // encodings, cycles, examples
  let enc = 0, ex = 0;
  for (const x of H.instructions) {
    checks++;
    const r = A.assemble(`  .text\n  ${x.enc}\nL:\n  nop\n  .data\nsym: .word 0\n`);
    if (!r.ok) { fail(`${x.n}: "${x.enc}" does not assemble: ${r.errors[0].message}`); continue; }
    const w = (r.text[0] | (r.text[1] << 8) | (r.text[2] << 16) | (r.text[3] << 24)) >>> 0;
    const f = A.fields(w), d = A.disassemble(w, 0);
    const bad = [];
    if ((w & 0x7f) !== x.op) bad.push(`opcode 0x${(w & 0x7f).toString(16)}, the Help says 0x${x.op.toString(16)}`);
    if (x.f3 !== undefined && ((w >>> 12) & 7) !== x.f3) bad.push(`funct3 ${(w >>> 12) & 7}, the Help says ${x.f3}`);
    if (x.f7 !== undefined && (w >>> 25) !== x.f7) bad.push(`funct7 0x${(w >>> 25).toString(16)}, the Help says 0x${x.f7.toString(16)}`);
    if (x.word !== undefined && w !== x.word) bad.push(`word 0x${w.toString(16)}, the Help says 0x${x.word.toString(16)}`);
    if (f.format !== x.f) bad.push(`format ${f.format}, the Help says ${x.f}`);
    if (d.mnemonic !== x.n) bad.push(`the disassembler reads it as ${d.mnemonic}`);
    const cyc = x.cyc || 3, core = x.grp === 'Loads' ? 4 : 3;
    if (cyc !== core) bad.push(`${cyc} cycles, the core takes ${core}`);
    if (bad.length) { fail(`${x.n}: ${bad.join('; ')}`); continue; }
    enc++;
    checks++;
    const run = runHelpProgram(N4, x.ex, { expect: x.expect, stop: x.stop || 11, ends: x.ends });
    if (!run.ok) fail(`${x.n}: the example ${run.problems.join('; ')}`);
    else ex++;
  }
  ok(`${enc} of ${H.instructions.length} encodings and cycle counts as the assembler and the core have them`);
  ok(`${ex} of ${H.instructions.length} instruction examples end as the Help says, on the model`);

  // idioms
  let id = 0;
  for (const x of H.idioms) {
    checks++;
    const run = runHelpProgram(N4, x.src, { expect: x.expect });
    if (!run.ok) fail(`idiom "${x.t}": ${run.problems.join('; ')}`);
    else id++;
  }
  ok(`${id} of ${H.idioms.length} idioms end as the Help says, on the model`);

  // the programs in the chapters of the page
  let xs = 0;
  for (const x of H.extras) {
    checks++;
    const run = runHelpProgram(N4, x.src, { expect: x.expect, stop: x.stop || 11, ends: x.ends });
    if (!run.ok) fail(`chapter program ${x.id}: ${run.problems.join('; ')}`);
    else xs++;
  }
  ok(`${xs} of ${H.extras.length} programs in the chapters end as the Help says, on the model`);

  // pseudo-instructions and directives
  let ps = 0;
  for (const [line] of H.pseudo) {
    checks++;
    const r = A.assemble(H.CONTEXT(`  ${line}`));
    if (!r.ok) fail(`pseudo-instruction "${line}": ${r.errors[0].message}`);
    else ps++;
  }
  ok(`${ps} of ${H.pseudo.length} pseudo-instruction lines assemble (the page shows their expansion by assembling them)`);
  let di = 0;
  for (const [name, , example] of H.directives) {
    checks++;
    const r = A.assemble(`  .text\n${example.split('\n').map((l) => (/^\w+:/.test(l) ? l : `  ${l}`)).join('\n')}\n`);
    if (!r.ok) fail(`directive ${name}: the example does not assemble: ${r.errors[0].message}`);
    else di++;
  }
  ok(`${di} of ${H.directives.length} directive examples assemble`);

  // messages
  let ms = 0;
  for (const [src, why] of H.messages) {
    checks++;
    const r = A.assemble(H.CONTEXT(`  ${src}`));
    // an explanation that says "A warning" must get a warning and no error; every other one an error
    const warn = /^A warning/.test(why);
    if (warn && !(r.ok && r.warnings.length)) fail(`message example "${src.replace(/\n/g, ' | ')}": the Help says a warning; the assembler gives ${r.ok ? 'nothing' : `an error: ${r.errors[0].message}`}`);
    else if (!warn && r.ok) fail(`message example "${src.replace(/\n/g, ' | ')}": the assembler accepts it${r.warnings.length ? ' with only a warning' : ' without a word'}`);
    else ms++;
  }
  ok(`${ms} of ${H.messages.length} message examples get the error or warning the Help says (the page shows the message)`);

  // causes
  checks++;
  const wrong = H.causes.filter(([n, text]) => N4.isa.CAUSE[n] !== text);
  if (wrong.length || H.causes.length !== Object.keys(N4.isa.CAUSE).length) fail(`trap causes differ from the model: ${wrong.map((c) => c[0]).join(', ')}`);
  else ok(`the ${H.causes.length} trap causes are the model's`);

  // the deliberate differences: the same cases as the test files that prove them (asm-check, isa-check)
  const fileCases = (f) => readFileSync(join(ROOT, 'tests', f), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  checks++;
  const asmFile = fileCases('asm/stricter.txt').map((l) => l.replace(/\\n/g, '\n'));
  const asmHelp = H.differences.assembler.map((d) => d[0]);
  if (JSON.stringify(asmFile) !== JSON.stringify(asmHelp)) fail('the assembler differences are not those of tests/asm/stricter.txt');
  else ok(`the ${asmHelp.length} assembler differences are tests/asm/stricter.txt`);
  for (const [code] of H.differences.assembler) {
    checks++;
    if (A.assemble(`  .text\n${code}\n`).ok) fail(`difference "${code}": the assembler accepts it`);
  }
  checks++;
  const isaFile = fileCases('isa/differences.txt').map((l) => { const [c, k] = l.split(/\s+=>\s+/); return `${c.replace(/\\n/g, '\n')} => ${k.trim()}`; });
  const isaHelp = H.differences.machine.map((d) => `${d[0]} => ${d[1]}`);
  if (JSON.stringify(isaFile) !== JSON.stringify(isaHelp)) fail('the processor differences are not those of tests/isa/differences.txt');
  else ok(`the ${isaHelp.length} processor differences are tests/isa/differences.txt`);

  console.log(`\n${checks} Help checks, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('help-check.mjs')) main();
