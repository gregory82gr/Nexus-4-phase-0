# ORBIT's last resort with the guardian (D59): a program that never takes the safe branch
# breaks the sequence again after every restart. The guardian's restarts count with the others: after
# three, the fourth violation stops the system.
# @guard Rods.tla
# @profile orbit
# @expect 9
  .text
  .globl _start
_start:
  nx.mark 3                   # scram
  nx.mark 1                   # withdraw: not until reset
  ecall
  .data
rods:    .word 10
command: .word 10
tripped: .word 0
