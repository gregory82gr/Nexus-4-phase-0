// Random RV32I programs for the ISA model and core checks (tools/isa-check.mjs, tools/core-check.mjs).
// Each program ends: straight code, forward branches and jumps, short counted loops, loads and stores
// inside a data buffer at s0. s0 and s1 (the loop counter) are never written by the body.
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let rnd;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const RD = () => pick(['x0', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6']);
const RS = () => (rnd() < 0.1 ? pick(['x0', 's0']) : RD());
const IMM = () => pick([int(-2048, 2047), -2048, 2047, 0, -1, 1, int(-16, 16)]);
const VAL = () => pick([int(-2147483648, 2147483647), 0, -1, 1, 0x7fffffff, -2147483648, int(-100, 100), 0x80000000 >>> 0, 0xffff, 0xff]);

export function randomProgram(seed, n) {
  rnd = prng(seed);
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
  // the end: tell Spike through tohost, then ecall, which stops the NEXUS-4 core and the model
  L.push('  la t0, tohost', '  li t1, 1', '  sw t1, 0(t0)', '  ecall', '  .data', 'buf:');
  for (let i = 0; i < 512; i++) L.push(`  .word ${VAL()}`);
  L.push('  .align 3', 'tohost: .word 0, 0', '');
  return L.join('\n');
}

