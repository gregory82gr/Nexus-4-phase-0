# ORBIT and the guardian (D59): a violation restarts the core with cause 4. The restarted
# program reads STATUS, sees the guardian's cause and takes its safe branch, the Simplex switch to the
# safe controller: it repairs the command (command = rods, which the guardian checks at that store) and
# inserts the rods. The scratchpads, and the guardian's copy of the variables, keep their values.
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
  lw    t0, 24(t2)            # STATUS: profile | cause << 8 | restarts << 16
  srli  t0, t0, 8
  andi  t0, t0, 255
  li    t1, 4
  beq   t0, t1, safe          # restarted by the guardian
  lw    t0, 4(s0)
loop:                         # the experimental controller: the command runs away
  addi  t0, t0, 1
  sw    t0, 4(s0)             # the sixth pass breaks "cmd - pos <= 5"
  nx.mark t0, 1               # withdraw
  j     loop
safe:                         # the safe controller
  lw    t0, 0(s0)
  sw    t0, 4(s0)             # command = rods: the invariants hold again
  nx.mark 3                   # scram
  li    t0, 5                 # the rods in, in steps of 5: the command leads by at most 5
  sw    t0, 4(s0)
  sw    t0, 0(s0)
  sw    zero, 4(s0)
  sw    zero, 0(s0)
  nx.mark 4                   # rods in
  ecall
