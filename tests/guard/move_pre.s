# A precondition broken (D64): move(7) asks for more than 5 steps. The entry marker is the violation;
# the function has not moved the rods yet.
# @guard Move.tla
# @expect 29
  .data
rods: .word 10
  .text
  .globl _start
_start:
  li    a0, 7
  jal   move
  ecall

move:
  nx.mark a0, 60
  la    t0, rods
  lw    t1, 0(t0)
  add   t1, t1, a0
  sw    t1, 0(t0)
  mv    a0, t1
  nx.mark a0, 61
  ret
