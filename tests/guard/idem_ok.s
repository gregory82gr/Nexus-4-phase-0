# Idempotent regions that are idempotent (D63). The first computes out = in + 1: it reads one word and
# writes another. The second writes a scratch word, reads it back and writes it again (write, read,
# write): the read is not exposed, because the region wrote the word first. Outside a region the
# program may do anything, here count = count + 1, which a region could not.
# @guard Buffers.tla
# @expect none
  .data
count: .word 0
in:    .word 41
out:   .word 0
tmp:   .word 0
  .text
  .globl _start
_start:
  la    s0, count
  nx.mark 50                  # a region
  lw    t0, 4(s0)             # in (an exposed read)
  addi  t0, t0, 1
  sw    t0, 8(s0)             # out: another word
  nx.mark 51                  # the end of the region
  nx.mark 50                  # another region
  sw    t0, 12(s0)            # tmp written
  lw    t1, 12(s0)            # and read: not exposed
  addi  t1, t1, 1
  sw    t1, 12(s0)            # and written again: allowed
  nx.mark 51
  lw    t2, 0(s0)             # outside a region: count = count + 1
  addi  t2, t2, 1
  sw    t2, 0(s0)
  ecall
