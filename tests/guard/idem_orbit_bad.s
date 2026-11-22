# The same restart, with a region that is not idempotent (D63): count = count + 1. Had the watchdog
# restarted the core in the middle, the second run would have counted twice. The guardian does not wait
# for that: the write to count after reading it is the violation, and ORBIT restarts the core at once
# (cause 4). The restarted program sees the cause in STATUS and stops without counting again.
# @guard Buffers.tla
# @profile orbit
# @wdt 60
# @expect 26
  .data
count: .word 0
  .text
  .globl _start
_start:
  la    s0, count
  li    s1, 0x20000
  lw    s2, 24(s1)            # STATUS
  srli  s3, s2, 8
  andi  s3, s3, 255
  li    t1, 4
  beq   s3, t1, done          # restarted by the guardian: count is already counted
  nx.mark 50                  # the region
  lw    t0, 0(s0)             # count
  addi  t0, t0, 1
  sw    t0, 0(s0)             # count = count + 1: not idempotent
hang:
  j     hang
done:
  ecall
