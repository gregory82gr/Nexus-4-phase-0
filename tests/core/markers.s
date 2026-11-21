# The guardian's marker instruction (D58): nx.mark rs1, event. It is in the custom-0 opcode space that
# RISC-V leaves to extensions (I-type, funct3 0, rd x0); the event number (0..2047) is the immediate and
# the value of rs1 goes with it on the commit port. It changes nothing in the machine and takes 3 cycles,
# like any ALU instruction, so a program with markers keeps its timing. GNU as has no name for it:
# .insn i 0x0b, 0, x0, rs1, event assembles the same word (tools/asm-check.mjs checks that it does).
# Spike, which knows only standard RISC-V, stops on it as an illegal instruction (tests/isa/extensions.txt).
  .text
  .globl _start
_start:
  li    a0, 1500
  nx.mark a0, 1               # event 1, with a value
  nx.mark 2                   # event 2, no value (rs1 = x0)
  li    t0, 3
loop:
  nx.mark t0, 10              # event 10, once per pass, with the pass counter
  addi  t0, t0, -1
  bnez  t0, loop
  nx.mark x31, 2047           # the largest event number
  ecall
