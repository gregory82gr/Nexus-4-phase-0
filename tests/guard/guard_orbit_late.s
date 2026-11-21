# ORBIT and a missed deadline (D59, proposed): the guardian restarts the core while it waits, between
# two instructions of its own. The restart starts the deadlines again, and the restarted program sees
# cause 4 in STATUS and reports the rods in at once.
# @guard rods.json
# @profile orbit
# @expect 11
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
  .text
  .globl _start
_start:
  li    t2, 0x20000
  lw    t0, 24(t2)            # STATUS
  srli  t0, t0, 8
  andi  t0, t0, 255
  li    t1, 4
  beq   t0, t1, safe
  nx.mark 3                   # scram
  li    t0, 40
wait:                         # too long
  addi  t0, t0, -1
  bnez  t0, wait
  nx.mark 4
  ecall
safe:
  nx.mark 3                   # scram again
  nx.mark 4                   # and the rods in at once
  ecall
