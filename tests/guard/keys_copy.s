# Boundedness (D62): a copied key puts a second token in a place whose capacity is 1 (code 17, keyA).
# @guard Keys.tla
# @expect 17
  .data
valve: .word 0
  .text
  .globl _start
_start:
  nx.mark 30                  # a copy of key A
  ecall
