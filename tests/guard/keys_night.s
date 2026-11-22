# A dead marking made by an automaton (D62): operator 1 does his job; then night falls, and operator 2,
# who works days only, may not take a key. His transition has its tokens but the shift automaton vetoes
# it, so no transition is enabled; the marking is not Final (operator 2 has not worked), and after 40
# cycles the guardian reports a deadlock. Had the night ended in time (Day), the net would have lived.
# @guard Keys.tla
# @expect 25
  .data
valve: .word 0
  .text
  .globl _start
_start:
  nx.mark 10                  # operator 1 takes A
  nx.mark 11                  # and B
  nx.mark 12                  # and returns both
  nx.mark 40                  # night: operator 2 may not start
wait:
  j     wait                  # and nobody comes
