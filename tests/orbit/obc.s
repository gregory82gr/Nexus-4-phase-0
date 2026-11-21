# The on-board computer of the NEXUS-2 orbiter, for the ORBIT profile (D56): fail-operational.
# At every start the program reads STATUS: bits 16-17 count the restarts the system has made, bits 8-9
# give the last one's cause (1 an error the code could not correct, 2 the watchdog, 3 a trap). The first
# time, the program runs its attitude task: it reads the four sensors, restarts the watchdog with the
# key and logs each pass, and on its last pass "hangs" (a loop that never restarts the watchdog). The
# watchdog restarts the core; the program starts again, sees the restart and its cause in STATUS, and
# goes to safe mode: it logs the cause and the count, finds the log the first run wrote (the scratchpads
# survive a restart; only the registers and the pc start again), and ends. (CORR, at +28, counts the
# errors the code corrected; tests/orbit/orbit_smoke.s reads it.)
# tools/core-check.mjs runs it with an 80-cycle watchdog and compares it with the ISA model.
  .equ IO, 0x20000            # the I/O page: sensors at 0-12, WDT at 20, STATUS at 24, CORR at 28
  .equ PASSES, 3
  .text
  .globl _start
_start:
  li    s0, IO
  lw    t0, 24(s0)            # STATUS
  srli  t1, t0, 16            # restarts so far
  bnez  t1, safe
  la    s1, log
  li    s3, PASSES
  li    s4, 0x5AFEC0DE        # the watchdog's key
pass:
  sw    s4, 20(s0)            # restart the watchdog
  lw    t2, 0(s0)             # attitude sensors
  lw    t3, 4(s0)
  lw    t4, 8(s0)
  lw    t5, 12(s0)
  add   t2, t2, t3            # a toy attitude estimate: the sum of the four
  add   t2, t2, t4
  add   t2, t2, t5
  sw    t2, 0(s1)
  addi  s1, s1, 4
  addi  s3, s3, -1
  bnez  s3, pass
hang:
  j     hang                  # a fault in the task: the watchdog is never restarted again
safe:
  la    s1, mode
  li    t2, 1
  sw    t2, 0(s1)             # safe mode
  andi  t3, t0, 0x300
  srli  t3, t3, 8
  sw    t3, 4(s1)             # the cause of the restart
  sw    t1, 8(s1)             # how many
  la    t6, log               # the log the first run wrote is still there: copy its first entry
  lw    t6, 0(t6)
  sw    t6, 12(s1)
  ecall
  .data
mode: .word 0, 0, 0, 0
log:  .word 0, 0, 0
