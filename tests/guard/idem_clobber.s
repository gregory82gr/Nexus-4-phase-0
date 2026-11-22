# A region that is not idempotent (D63): count = count + 1 reads count, then writes it. Run again from its
# start, after a restart, the region would count twice. The store is the violation (code 26).
# @guard Buffers.tla
# @expect 26
  .data
count: .word 0
  .text
  .globl _start
_start:
  la    s0, count
  nx.mark 50
  lw    t0, 0(s0)             # an exposed read of count
  addi  t0, t0, 1
  sw    t0, 0(s0)             # a write to it: a clobber antidependence
  nx.mark 51
  ecall
