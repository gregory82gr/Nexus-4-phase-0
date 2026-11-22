# The guardian checks the data image before the first instruction (D59): rods 50 breaks "pos <= 40"
# in the first cycle, and no instruction completes.
# @guard Rods.tla
# @expect 1
  .data
rods:    .word 50
command: .word 50
tripped: .word 0
  .text
  .globl _start
_start:
  nop
  ecall
