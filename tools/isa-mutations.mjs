// NEXUS-4 ISA model mutation checks: Spike and the riscv-tests must catch a broken reference model.
//
// Each mutation below breaks the model in index.html in one specific way. tools/isa-check.mjs (one
// random program of 1,500 statements, for speed) and then tools/riscv-tests.mjs are run against the
// broken copy; at least one must fail. A mutation whose text is no longer found, or not unique, fails too.
//
// Usage: SPIKE=... RISCV_TESTS=... node tools/isa-mutations.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export const MUTATIONS = [
  // arithmetic and comparisons
  { name: 'sra shifts in zeros', find: "case 'sra': wd = a >> (b & 31); break;", replace: "case 'sra': wd = (a >>> (b & 31)) | 0; break;" },
  { name: 'srl ignores the upper bits of the count rule', find: "case 'srl': wd = (a >>> (b & 31)) | 0; break;", replace: "case 'srl': wd = b > 31 ? 0 : (a >>> b) | 0; break;" },
  { name: 'sltu compares signed', find: "case 'sltu': wd = (a >>> 0) < (b >>> 0) ? 1 : 0; break;", replace: "case 'sltu': wd = a < b ? 1 : 0; break;" },
  { name: 'sltiu without sign extension of the immediate', find: "case 'sltiu': wd = (a >>> 0) < (imm >>> 0) ? 1 : 0; break;", replace: "case 'sltiu': wd = (a >>> 0) < (imm & 0xfff) ? 1 : 0; break;" },
  { name: 'slti compares unsigned', find: "case 'slti': wd = a < imm ? 1 : 0; break;", replace: "case 'slti': wd = (a >>> 0) < (imm >>> 0) ? 1 : 0; break;" },
  { name: 'sub adds', find: "case 'sub': wd = (a - b) | 0; break;", replace: "case 'sub': wd = (a + b) | 0; break;" },
  // control flow
  { name: 'bge is strict', find: "case 'bge': if (a >= b) jump(pc + imm); break;", replace: "case 'bge': if (a > b) jump(pc + imm); break;" },
  { name: 'bltu compares signed', find: "case 'bltu': if ((a >>> 0) < (b >>> 0)) jump(pc + imm); break;", replace: "case 'bltu': if (a < b) jump(pc + imm); break;" },
  { name: 'jalr keeps bit 0 of the target', find: "case 'jalr': jump((a + imm) & ~1);", replace: "case 'jalr': jump(a + imm);" },
  { name: 'jal links to its own address', find: "case 'jal': jump(pc + imm); wd = (pc + 4) | 0; break;", replace: "case 'jal': jump(pc + imm); wd = pc | 0; break;" },
  { name: 'auipc adds to the next pc', find: "case 'auipc': wd = (pc + imm) | 0; break;", replace: "case 'auipc': wd = (pc + 4 + imm) | 0; break;" },
  { name: 'jalr reads rs1 after writing rd', find: "const a = x[d.rs1], b = x[d.rs2], imm = d.imm;", replace: "if (d.name === 'jalr') x[d.rd] = d.rd ? pc + 4 : 0; const a = x[d.rs1], b = x[d.rs2], imm = d.imm;" },
  // registers and memory
  { name: 'x0 can be written', find: "if (wd !== null && d.rd !== 0) {", replace: "if (wd !== null) {" },
  { name: 'lb zero-extends', find: "wd = this.read(addr, size, d.name === 'lb' || d.name === 'lh' || d.name === 'lw');", replace: "wd = this.read(addr, size, d.name === 'lh' || d.name === 'lw');" },
  { name: 'lhu sign-extends', find: "const size = d.name === 'lb' || d.name === 'lbu' ? 1 : d.name === 'lw' ? 4 : 2;", replace: "const size = d.name === 'lb' || d.name === 'lbu' ? 1 : d.name === 'lw' ? 4 : 2; if (d.name === 'lhu') d.name = 'lh';" },
  { name: 'sh stores a word', find: "const size = d.name === 'sb' ? 1 : d.name === 'sh' ? 2 : 4;", replace: "const size = d.name === 'sb' ? 1 : 4;" },
  { name: 'little-endian bytes reversed on store', find: "for (let k = 0; k < size; k++) m[off + k] = (value >>> (8 * k)) & 0xff;", replace: "for (let k = 0; k < size; k++) m[off + size - 1 - k] = (value >>> (8 * k)) & 0xff;" },
  // traps
  { name: 'misaligned loads allowed', find: "if (addr % size) throw new Trap(store ? 6 : 4, addr);", replace: "if (store && addr % size) throw new Trap(6, addr);" },
  { name: 'misaligned jump targets allowed', find: "const jump = (t) => { t >>>= 0; if (t & 3) throw new Trap(0, t); npc = t; };", replace: "const jump = (t) => { t >>>= 0; if (t & 1) throw new Trap(0, t); npc = t; };" },
  { name: 'access fault checked before alignment', find: "      if (addr % size) throw new Trap(store ? 6 : 4, addr);\n      const off = addr - this.map.dmem.base;\n      if (off < 0 || off + size > this.map.dmem.size) throw new Trap(store ? 7 : 5, addr);", replace: "      const off = addr - this.map.dmem.base;\n      if (off < 0 || off + size > this.map.dmem.size) throw new Trap(store ? 7 : 5, addr);\n      if (addr % size) throw new Trap(store ? 6 : 4, addr);" },
  { name: 'loads may read the instruction scratchpad', find: "if (off < 0 || off + size > this.map.dmem.size) throw new Trap(store ? 7 : 5, addr);\n      return off;", replace: "if (off < 0 || off + size > this.map.dmem.size) { if (!store) return 0; throw new Trap(7, addr); }\n      return off;" },
  { name: 'fence.i accepted', find: "return f3 === 0 ? { name: 'fence', rd, rs1, rs2: 0, imm: immI, fmt: 'I' } : null;", replace: "return { name: 'fence', rd, rs1, rs2: 0, imm: immI, fmt: 'I' };" },
  { name: 'srli accepts any funct7', find: "case 5: return f7 === 0 ? { name: 'srli', rd, rs1, rs2: 0, imm: rs2, fmt: 'I' }", replace: "case 5: return f7 !== 0x20 ? { name: 'srli', rd, rs1, rs2: 0, imm: rs2, fmt: 'I' }" },
  { name: 'illegal instruction reports tval 0', find: "if (!d) throw new Trap(2, w);", replace: "if (!d) throw new Trap(2, 0);" },
  { name: 'ebreak reported as ecall', find: "case 'ebreak': throw new Trap(3, pc);", replace: "case 'ebreak': throw new Trap(11, 0);" },
];

function main() {
  const original = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const work = mkdtempSync(join(tmpdir(), 'nexus4-isa-mutants-'));
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
      const env = { ...process.env, NEXUS4_INDEX: file, NEXUS4_SEED: '4004', NEXUS4_FUZZ: '1500' };
      let by = null;
      for (const tool of ['isa-check.mjs', 'riscv-tests.mjs']) {
        const run = spawnSync(process.execPath, [join(ROOT, 'tools', tool)], { env, encoding: 'utf8' });
        if (run.status !== 0) {
          const first = (run.stdout.split('\n').find((l) => l.startsWith('FAIL')) || run.stderr.split('\n')[0] || '').replace(/^FAIL\s+/, '');
          by = `${tool}: ${first.slice(0, 90)}`;
          break;
        }
      }
      console.log(`${by ? 'CAUGHT   ' : 'SURVIVED '} ${m.name}${by ? `  (${by})` : ''}`);
      if (!by) survived++;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${MUTATIONS.length - survived - stale} of ${MUTATIONS.length} ISA model mutations caught.`);
  process.exit(survived || stale ? 1 : 0);
}

main();
