# The I/O page and PLANT in a few instructions (D55): every register of the page is read or written
# once. Short, so that tools/core-check.mjs can compare the whole PLANT system on the NEXUS-4 kernel
# with GHDL delta cycle by delta cycle (two cores, the lockstep, the parity checks, the I/O page).
  .text
  .globl _start
_start:
  li    s0, 0x20000           # the I/O page
  li    t0, 0x5AFEC0DE
  sw    t0, 20(s0)            # restart the watchdog
  lw    a0, 0(s0)             # sensor 0
  lw    a1, 12(s0)            # sensor 3
  lw    a2, 24(s0)            # STATUS: the profile
  li    t1, 1
  sw    t1, 16(s0)            # trip
  lw    a3, 16(s0)            # TRIP: 1, the program asked for it
  la    t2, out
  sw    a3, 0(t2)
  lw    a4, 0(t2)             # a load from RAM after loads from the page
  ecall
  .data
out: .word 0
