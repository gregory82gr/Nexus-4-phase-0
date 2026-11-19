# A small program in the style NEXUS-4 will run: a scan loop of a protection channel.
# Three sensor readings are compared with a limit; two out of three over the limit is a trip.
  .text
  .equ LIMIT, 600
  .equ SENSORS, 3

reset:
  la    s0, readings          # s0 = &readings[0]
  li    s1, LIMIT
  li    s2, 0                 # scan counter

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
  la    t2, trip
  sw    t6, 0(t2)
  addi  s2, s2, 1
  j     scan

  .data
readings:
  .word 300, 650, 700
trip:
  .word 0
