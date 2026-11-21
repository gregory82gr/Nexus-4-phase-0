# ORBIT in a few instructions (D56): a trap restarts the core, the second run sees why in STATUS,
# stores a byte (a partial store re-encodes its word), reads it back and reads CORR. Short, so that
# tools/core-check.mjs can compare the whole ORBIT system on the NEXUS-4 kernel with GHDL delta cycle by
# delta cycle (the votes, the codes, the scrubbers, the restart).
  .text
  .globl _start
_start:
  li    s0, 0x20000           # the I/O page
  lw    a0, 24(s0)            # STATUS
  srli  a1, a0, 16            # restarts so far
  bnez  a1, again
  ebreak                      # the first run stops on a trap: the system restarts the core
again:
  la    t2, out
  sb    a0, 1(t2)             # STATUS's low byte into byte 1 of the word
  lw    a2, 0(t2)
  lw    a3, 28(s0)            # CORR: none in a fault-free run
  ecall
  .data
out: .word 0x11223344
