# A call inside a call (D64): the contract's ghosts hold one call's argument and old position, so Move.tla
# allows no call to begin inside another, with an automaton (call: "out" or "in"). The second entry is
# the violation, before it could overwrite the first call's ghosts.
# @guard Move.tla
# @expect 9
  .data
rods: .word 10
  .text
  .globl _start
_start:
  li    a0, 2
  nx.mark a0, 60              # entry
  nx.mark a0, 60              # a second entry, before the exit
  ecall
