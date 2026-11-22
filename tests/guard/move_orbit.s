# ORBIT and a contract (D59, D64): the first run calls a move with a bug (one step too many), the guardian
# restarts the core at its exit (cause 4), and the restarted program puts the rods back with the careful
# move, whose contract holds. The ghosts start again from 0 after the restart; the rods do not.
# @guard Move.tla
# @profile orbit
# @expect 31
  .data
rods: .word 10
  .text
  .globl _start
_start:
  li    t2, 0x20000
  lw    t3, 24(t2)            # STATUS
  srli  t3, t3, 8
  andi  t3, t3, 255
  li    t4, 4
  beq   t3, t4, safe
  li    a0, 3
  jal   fast                  # 10 → 14: broken
  ecall
safe:
  li    a0, 0
  jal   careful               # a move of 0: the rods stay at 14, and the contract holds
  ecall

fast:
  nx.mark a0, 60
  la    t0, rods
  lw    t1, 0(t0)
  add   t1, t1, a0
  addi  t1, t1, 1
  sw    t1, 0(t0)
  mv    a0, t1
  nx.mark a0, 61
  ret

careful:
  nx.mark a0, 60
  la    t0, rods
  lw    t1, 0(t0)
  add   t1, t1, a0
  sw    t1, 0(t0)
  mv    a0, t1
  nx.mark a0, 61
  ret
