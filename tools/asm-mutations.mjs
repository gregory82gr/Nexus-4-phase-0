// NEXUS-4 assembler mutation checks: the GNU comparison must catch a broken assembler.
//
// Each mutation below breaks the assembler or disassembler in index.html in one specific way.
// tools/asm-check.mjs is run against the broken copy (one random program of 800 lines, for
// speed) and must fail. If a mutation's text is no longer found in index.html, this script
// fails too, so the list is kept up to date with the assembler.
//
// Usage: node tools/asm-mutations.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export const MUTATIONS = [
  // encoding
  { name: 'lui/auipc high part without rounding', find: 'const hi20 = (v) => (((v + 0x800) >>> 12) & 0xfffff);', replace: 'const hi20 = (v) => ((v >>> 12) & 0xfffff);' },
  { name: 'B-type immediate bit 11 in the wrong place', find: '(((imm >> 1) & 0xf) << 8) | (((imm >> 11) & 1) << 7) | op) >>> 0;', replace: '(((imm >> 1) & 0xf) << 8) | (((imm >> 12) & 1) << 7) | op) >>> 0;' },
  { name: 'J-type immediate without bit 11', find: '(((imm >> 11) & 1) << 20) |', replace: '(0 << 20) |' },
  { name: 'S-type immediate halves swapped', find: '((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((imm & 0x1f) << 7) | op)', replace: '(((imm & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (((imm >> 7) & 0x1f) << 7) | op)' },
  { name: 'srai encoded as srli', find: "srai: [5, 0x20]", replace: "srai: [5, 0]" },
  // GNU's expansion of pseudo-instructions
  { name: 'li always uses two instructions', find: '      if (v >= -2048 && v <= 2047) return 1;\n      return lo12(v) === 0 && rd !== 0 ? 1 : 2;', replace: '      return 2;' },
  { name: 'li drops the addi for x0 too', find: 'if (lo12(x) !== 0 || rd === 0) out.push', replace: 'if (lo12(x) !== 0) out.push' },
  { name: 'ble does not swap its operands', find: "case 'ble': n(3); return [B(5, reg(args[1]), reg(args[0]), args[2])];", replace: "case 'ble': n(3); return [B(5, reg(args[0]), reg(args[1]), args[2])];" },
  { name: 'sgtz compares the wrong way', find: "case 'sgtz': n(2); return [encR(0, reg(args[1]), 0, 2, reg(args[0]), OP.OP)];", replace: "case 'sgtz': n(2); return [encR(0, 0, reg(args[1]), 2, reg(args[0]), OP.OP)];" },
  { name: 'call links through t1 instead of ra', find: "const link = op === 'call' ? 1 : 0", replace: "const link = op === 'call' ? 6 : 0" },
  { name: 'R-type with an immediate rejected', find: "if (regOf(args[2]) === null && op !== 'sub') return encode", replace: "if (false) return encode" },
  // checks and directives
  { name: 'no range check on 12-bit immediates', find: 'if (v < -2048 || v > 2047) throw new AsmError(`immediate ${v} out of range (-2048..2047)`, line); return v;', replace: 'return v;' },
  { name: 'x0 allowed as the target of la', find: 'const rd = noZero(reg(args[0])), off', replace: 'const rd = reg(args[0]), off' },
  { name: '.balign takes a power of two', find: "alignTo(op === '.balign' ? n : 1 << n,", replace: "alignTo(1 << n," },
  // disassembler
  { name: 'disassembler: B immediate without its sign', find: 'const bImm = ((((w | 0) >> 31) << 12) |', replace: 'const bImm = ((((w >>> 31) & 1) << 12) |' },
  { name: 'disassembler: I immediate zero-extended', find: '    const iImm = (w | 0) >> 20;\n    const sImm', replace: '    const iImm = w >>> 20;\n    const sImm' },
];

function main() {
  const original = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const work = mkdtempSync(join(tmpdir(), 'nexus4-asm-mutants-'));
  let survived = 0, stale = 0;
  try {
    for (const m of MUTATIONS) {
      const at = original.indexOf(m.find);
      if (at < 0 || original.indexOf(m.find, at + 1) >= 0) {
        console.log(`STALE     ${m.name}: its text is ${at < 0 ? 'no longer in' : 'not unique in'} index.html`);
        stale++;
        continue;
      }
      const file = join(work, 'index.html');
      writeFileSync(file, original.replace(m.find, m.replace));
      const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'asm-check.mjs')],
        { env: { ...process.env, NEXUS4_INDEX: file, NEXUS4_SEED: '4004', NEXUS4_FUZZ: '800' }, encoding: 'utf8' });
      const caught = run.status !== 0;
      const first = (run.stdout.split('\n').find((l) => l.startsWith('FAIL')) || run.stderr.split('\n')[0] || '').replace(/^FAIL\s+/, '');
      console.log(`${caught ? 'CAUGHT   ' : 'SURVIVED '} ${m.name}${caught ? `  (${first.slice(0, 90)})` : ''}`);
      if (!caught) survived++;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${MUTATIONS.length - survived - stale} of ${MUTATIONS.length} assembler mutations caught.`);
  process.exit(survived || stale ? 1 : 0);
}

main();
