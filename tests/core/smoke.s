# A short program that touches every class of instruction once: the NEXUS-4 core runs it on the
# NEXUS-4 kernel and on GHDL, and the two must agree delta cycle by delta cycle (tools/core-check.mjs).
  .text
  .globl _start
_start:
  li    a0, 5                 # addi
  li    a1, -3
  add   a2, a0, a1            # 2
  sub   a3, a1, a0            # -8
  sltu  a4, a0, a1            # 1: -3 is huge unsigned
  sra   a5, a3, a4            # -4
  lui   t0, 0x12345
  auipc t1, 0
  la    s0, data
  lw    t2, 0(s0)
  lbu   t3, 1(s0)
  lh    t4, 2(s0)
  sb    a0, 4(s0)
  sh    a1, 6(s0)
  sw    a3, 8(s0)
  beq   a0, a1, skip          # not taken
  bne   a0, a1, 1f            # taken
  addi  a0, a0, 100           # skipped
1:
  jal   ra, sub1
  fence
  lw    s1, 4(s0)
skip:
  ecall
sub1:
  addi  a0, a0, 1
  jalr  zero, 0(ra)

  .data
data:
  .word 0x8badf00d, 0, 0
