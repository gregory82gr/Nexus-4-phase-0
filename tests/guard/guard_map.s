# A byte store to a mapped variable (D59): the guardian keeps whole words, so it cannot follow a part
# of one, and it stops the program instead (code 15).
# @guard Rods.tla
# @expect 15
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
  .text
  .globl _start
_start:
  la    s0, rods
  li    t0, 1
  sb    t0, 8(s0)             # a byte of tripped
  ecall
