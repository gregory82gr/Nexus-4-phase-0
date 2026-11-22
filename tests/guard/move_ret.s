# A result broken (D64): this move moves the rods right but returns their old position. The other half
# of the postcondition (result = rods) catches it.
# @guard Move.tla
# @expect 32
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
  add   t2, t1, a0
  sw    t2, 0(t0)
  mv    a0, t1                # the bug: the old position
  nx.mark a0, 61
  ret
