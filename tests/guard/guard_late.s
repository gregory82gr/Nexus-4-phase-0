# A deadline missed (D59): after a scram the rods must be reported in within 90 cycles; this program
# waits too long. The guardian stops it while it waits, not at an instruction of its own.
# @guard Rods.tla
# @expect 11
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
  .text
  .globl _start
_start:
  nx.mark 3                   # scram
  li    t0, 40
wait:
  addi  t0, t0, -1
  bnez  t0, wait
  nx.mark 4                   # rods in: too late
  ecall
