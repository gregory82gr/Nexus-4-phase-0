# A rod-control sequence that keeps every property of Rods.tla (D59, D61): no violation.
# Withdraw the rods 5 steps, one at a time: the command leads, the rods follow, and the two never
# differ by more than 5. Then scram: insert them in steps of 5, report them in within the deadline,
# clear the trip, reset, and run on for longer than the deadline.
# @guard Rods.tla
# @expect none
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
  .text
  .globl _start
_start:
  la    s0, rods
  li    t1, 5
withdraw:
  lw    t0, 4(s0)             # command += 1
  addi  t0, t0, 1
  sw    t0, 4(s0)
  nx.mark t0, 1               # withdraw
  sw    t0, 0(s0)             # the rods follow
  addi  t1, t1, -1
  bnez  t1, withdraw
  li    t0, 1
  sw    t0, 8(s0)             # tripped = 1
  nx.mark 3                   # scram: the deadline starts
  lw    t0, 0(s0)             # 15
insert:
  addi  t0, t0, -5
  sw    t0, 4(s0)             # command 5 below the rods
  sw    t0, 0(s0)             # the rods follow
  nx.mark t0, 2               # insert
  bnez  t0, insert
  nx.mark 4                   # rods in: within the deadline
  sw    zero, 8(s0)           # tripped = 0
  nx.mark 5                   # reset
  li    t0, 25                # and run on past where the deadline would have run out, had rods in
idle:                         # not stopped it
  addi  t0, t0, -1
  bnez  t0, idle
  ecall
