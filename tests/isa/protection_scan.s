# The scan loop of a protection channel (tests/asm/plant_scan.s), run for a fixed number of scans
# while the readings rise, then the program ends. Two out of three readings over the limit is a trip:
# the trips array ends as 0, 1, 1, 1. CI compares every instruction with Spike; the write to tohost
# tells Spike the program is done, and ecall stops the NEXUS-4 core.
  .text
  .globl _start
  .equ LIMIT, 600
  .equ SENSORS, 3
  .equ SCANS, 4

_start:
  la    s0, readings
  li    s1, LIMIT
  li    s2, 0                 # scan counter
  la    s3, trips             # one result word per scan

scan:
  li    t0, 0                 # votes
  li    t1, 0                 # index
vote:
  slli  t2, t1, 2
  add   t2, s0, t2
  lw    t3, 0(t2)
  ble   t3, s1, next          # not over the limit
  addi  t0, t0, 1
next:
  addi  t1, t1, 1
  li    t4, SENSORS
  blt   t1, t4, vote

  li    t5, 2
  slt   t6, t0, t5            # t6 = 1 if votes < 2
  xori  t6, t6, 1             # trip = votes >= 2
  slli  t2, s2, 2
  add   t2, s3, t2
  sw    t6, 0(t2)

  # the plant moves on: every reading rises by 150
  li    t1, 0
drift:
  slli  t2, t1, 2
  add   t2, s0, t2
  lw    t3, 0(t2)
  addi  t3, t3, 150
  sw    t3, 0(t2)
  addi  t1, t1, 1
  blt   t1, t4, drift

  addi  s2, s2, 1
  li    t5, SCANS
  blt   s2, t5, scan

  la    t0, tohost
  li    t1, 1
  sw    t1, 0(t0)
  ecall

  .data
readings:
  .word 300, 500, 580
trips:
  .word 0, 0, 0, 0
  .align 3
tohost: .word 0, 0
