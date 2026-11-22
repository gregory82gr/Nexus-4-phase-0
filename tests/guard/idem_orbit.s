# Why idempotency matters in ORBIT (D56, D63). A warm restart runs the program again from its start with
# the scratchpad as it was. This region computes out = in + 1; the first run stops in the middle (it hangs
# and the watchdog restarts the core), the second runs it again from the start and gets the same out.
# The region is idempotent, so running it twice is the same as running it once, and the guardian agrees.
# @guard Buffers.tla
# @profile orbit
# @wdt 60
# @expect none
  .data
count: .word 0
in:    .word 41
out:   .word 0
  .text
  .globl _start
_start:
  la    s0, count
  li    s1, 0x20000
  lw    s2, 24(s1)            # STATUS: restarts in bits 16-17
  srli  s2, s2, 16
  nx.mark 50                  # the region
  lw    t0, 4(s0)             # in
  addi  t0, t0, 1
  sw    t0, 8(s0)             # out = in + 1
  beqz  s2, hang              # the first run hangs here, inside the region
  nx.mark 51
  ecall
hang:
  j     hang                  # the watchdog restarts the core
