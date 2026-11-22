# A transition that is not enabled (D62): operator 1 returns the keys without having taken them
# (code 16). The marker that fires it is the last instruction to complete.
# @guard Keys.tla
# @expect 16
  .data
valve: .word 0
  .text
  .globl _start
_start:
  nx.mark 10                  # operator 1 takes A
  nx.mark 12                  # and returns A and B: it never had B
  ecall
