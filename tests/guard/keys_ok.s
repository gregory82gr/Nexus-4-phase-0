# The key interlock used as it should be (D62): operator 1 takes key A, then B, opens the valve, closes it
# and returns both keys; then operator 2 does the same, B first. The net ends in its Final marking: no
# transition is enabled, but that is the end, not a deadlock, so the program may run on.
# @guard Keys.tla
# @expect none
  .data
valve: .word 0
  .text
  .globl _start
_start:
  la    s0, valve
  li    t0, 1
  nx.mark 10                  # operator 1 takes A
  nx.mark 11                  # and B
  sw    t0, 0(s0)             # opens the valve
  sw    zero, 0(s0)           # closes it
  nx.mark 12                  # returns both keys
  nx.mark 20                  # operator 2 takes B
  nx.mark 21                  # and A
  sw    t0, 0(s0)
  sw    zero, 0(s0)
  nx.mark 22                  # returns both
  li    t1, 30                # and the program runs on, well past 40 cycles
idle:
  addi  t1, t1, -1
  bnez  t1, idle
  ecall
