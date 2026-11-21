# A sequence broken (D59): a withdrawal after a scram, with no reset between, breaks the automaton.
# The marker that breaks it is the last instruction to complete.
# @guard rods.json
# @expect 9
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
  .text
  .globl _start
_start:
  nx.mark 1                   # withdraw: allowed
  nx.mark 3                   # scram
  nx.mark 2                   # insert: allowed
  nx.mark 1                   # withdraw: not until reset
  ecall
