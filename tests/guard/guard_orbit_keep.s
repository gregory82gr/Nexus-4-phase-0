# ORBIT: the guardian remembers (D59). A restart starts its automata and deadlines again but
# keeps its copy of the variables, as the scratchpad keeps them, so the restarted program must repair
# what was broken before anything else. Here the first safe branch stores the trip flag first: every
# invariant is checked again at that store, the broken one with it, and the core is restarted a second
# time. The second time the program repairs the command first, then trips.
# @guard Rods.tla
# @profile orbit
# @expect 3
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
  .text
  .globl _start
_start:
  la    s0, rods
  li    t2, 0x20000
  lw    t3, 24(t2)            # STATUS: profile | cause << 8 | restarts << 16
  srli  t3, t3, 16            # restarts so far
  li    t1, 1
  beq   t3, t1, wrong_order
  li    t1, 2
  beq   t3, t1, repair_first
  lw    t0, 4(s0)
loop:                         # the experimental controller: the command runs away
  addi  t0, t0, 1
  sw    t0, 4(s0)
  j     loop
wrong_order:
  li    t0, 1
  sw    t0, 8(s0)             # tripped = 1, but the command is still 6 ahead: restarted again
  ecall
repair_first:
  lw    t0, 0(s0)
  sw    t0, 4(s0)             # command = rods
  li    t0, 1
  sw    t0, 8(s0)             # tripped = 1
  ecall
