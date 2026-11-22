# Hoare contracts kept (D64): move(steps) moves the rods by steps and returns where they are. Its entry
# marker carries the argument, its exit marker the result; Move.tla says what both must satisfy.
# @guard Move.tla
# @expect none
  .data
rods: .word 10
  .text
  .globl _start
_start:
  li    a0, 3
  jal   move                  # 10 → 13
  li    a0, 5
  jal   move                  # 13 → 18
  ecall

move:                         # a0 = steps; returns the new position in a0
  nx.mark a0, 60              # entry: the argument
  la    t0, rods
  lw    t1, 0(t0)
  add   t1, t1, a0
  sw    t1, 0(t0)
  mv    a0, t1
  nx.mark a0, 61              # exit: the result
  ret
