# The parity check before a partial store (D55, D67). A byte or half-word store merges into the word that
# is there, and the merged word gets a new parity bit. If that word was upset before the merge, the new
# parity bit would seal the upset in: every later load would pass. So in PLANT the data scratchpad checks
# the old word's parity before it merges. tools/fault-campaign.mjs --plant flips a bit of each word below
# in the bytes the store keeps, between the whole-word store and the partial one, and requires a parity
# trip at the partial store, before the load that reads the word back.
  .data
w0: .word 0
w1: .word 0
  .text
  .globl _start
_start:
  la    s0, w0
  li    t0, 0x12345678
  sw    t0, 0(s0)             # word 0 whole: a new parity bit
  li    t0, 0x0BADF00D
  sw    t0, 4(s0)             # word 1 whole
  addi  zero, zero, 0         # (a window for the upsets)
  addi  zero, zero, 0
  li    t1, 0x99
  sb    t1, 0(s0)             # byte 0 of word 0: bytes 1-3 kept, their parity checked first
  li    t1, 0x7E57
  sh    t1, 6(s0)             # the upper half of word 1: the lower half kept, checked first
  lw    t2, 0(s0)             # 0x12345699
  lw    t3, 4(s0)             # 0x7E57F00D
  ecall
