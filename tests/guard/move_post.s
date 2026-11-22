# A postcondition broken (D64): this move adds one step too many. At its exit the rods are not where the
# argument and the old position say (rods = old + steps), and the exit marker is the violation.
# @guard Move.tla
# @expect 31
  .data
rods: .word 10
  .text
  .globl _start
_start:
  li    a0, 3
  jal   move
  ecall

move:
  nx.mark a0, 60
  la    t0, rods
  lw    t1, 0(t0)
  add   t1, t1, a0
  addi  t1, t1, 1             # the bug: one step too many
  sw    t1, 0(t0)
  mv    a0, t1
  nx.mark a0, 61
  ret
