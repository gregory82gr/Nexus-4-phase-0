# An invariant broken by a store (D59): the command runs ahead of the rods by 6, breaking
# "cmd - pos <= 5". The store that breaks it is the last instruction to complete.
# @guard rods.json
# @expect 3
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
  .text
  .globl _start
_start:
  la    s0, rods
  lw    t0, 4(s0)
loop:
  addi  t0, t0, 1
  sw    t0, 4(s0)             # the sixth pass breaks it
  nx.mark t0, 1               # withdraw (the rods never follow)
  j     loop
