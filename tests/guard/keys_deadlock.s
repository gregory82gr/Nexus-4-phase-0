# A deadlock (D62): operator 1 takes key A while operator 2 takes key B. Each now waits for the other's
# key: no transition of the net is enabled and the marking is not Final. The program waits too, and the
# guardian reports the dead marking 40 cycles after it began (code 25).
# @guard Keys.tla
# @expect 25
  .data
valve: .word 0
  .text
  .globl _start
_start:
  nx.mark 10                  # operator 1 takes A
  nx.mark 20                  # operator 2 takes B: dead
wait:
  j     wait                  # each waits for the other
