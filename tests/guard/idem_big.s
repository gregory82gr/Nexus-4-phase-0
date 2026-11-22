# A region too large to check (D63): it reads nine different words, and the guardian remembers eight
# exposed reads. Rather than forget one, it reports the region (code 27).
# @guard Buffers.tla
# @expect 27
  .data
count: .word 0
table: .word 1, 2, 3, 4, 5, 6, 7, 8, 9
  .text
  .globl _start
_start:
  la    s0, table
  li    t1, 0
  li    t2, 9
  nx.mark 50
sum:
  lw    t0, 0(s0)             # the ninth exposed read is one too many
  add   t1, t1, t0
  addi  s0, s0, 4
  addi  t2, t2, -1
  bnez  t2, sum
  nx.mark 51
  ecall
