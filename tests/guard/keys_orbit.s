# ORBIT and a deadlock (D59, D62): the guardian restarts the core with cause 4; the restarted program,
# which sees the cause in STATUS, lets the operators work one after the other. The restart puts the net
# back in its first marking (the keys in the rack).
# @guard Keys.tla
# @profile orbit
# @expect 25
  .data
valve: .word 0
  .text
  .globl _start
_start:
  li    t2, 0x20000
  lw    t0, 24(t2)            # STATUS
  srli  t0, t0, 8
  andi  t0, t0, 255
  li    t1, 4
  beq   t0, t1, safe
  nx.mark 10                  # operator 1 takes A
  nx.mark 20                  # operator 2 takes B: dead
wait:
  j     wait
safe:                         # one operator at a time
  nx.mark 10
  nx.mark 11
  nx.mark 12
  nx.mark 20
  nx.mark 21
  nx.mark 22
  ecall
