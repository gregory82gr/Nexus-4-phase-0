# One protection channel of the NEXUS-1 plant, for the PLANT profile (D55).
# Each pass restarts the watchdog, reads three redundant pressure transmitters and the neutron flux
# from the I/O page, votes two out of three on pressure, and asks for a trip on the vote or on high
# flux. Every pass logs what it read and decided in the data scratchpad. The sensor values come from
# the program package (tools/core-check.mjs and tools/fault-campaign.mjs give 1520, 1480, 1530, 850:
# two of three pressures are above the setpoint, so the channel must trip).
  .equ IO, 0x20000            # the I/O page: sensors at 0-12, TRIP at 16, WDT at 20
  .equ PASSES, 6
  .text
  .globl _start
_start:
  li    s0, IO
  la    s1, log
  la    s2, setpoints
  li    s3, PASSES
  li    s4, 0x5AFEC0DE        # the watchdog's key
pass:
  sw    s4, 20(s0)            # restart the watchdog
  lw    t0, 0(s0)             # pressure 1
  lw    t1, 4(s0)             # pressure 2
  lw    t2, 8(s0)             # pressure 3
  lw    t3, 12(s0)            # neutron flux
  lw    a0, 0(s2)             # the pressure setpoint
  lw    a1, 4(s2)             # the flux setpoint
  slt   t4, a0, t0            # pressure 1 high
  slt   t5, a0, t1
  slt   t6, a0, t2
  and   a2, t4, t5            # two out of three: (1 and 2) or (1 and 3) or (2 and 3)
  and   a3, t4, t6
  or    a2, a2, a3
  and   a3, t5, t6
  or    a2, a2, a3
  slt   a3, a1, t3            # flux high
  or    a2, a2, a3            # the trip demand
  sw    t0, 0(s1)             # the log: what was read, and the decision
  sw    t1, 4(s1)
  sw    t2, 8(s1)
  sw    t3, 12(s1)
  sw    a2, 16(s1)
  addi  s1, s1, 20
  beqz  a2, 1f
  sw    a2, 16(s0)            # trip
1:
  addi  s3, s3, -1
  bnez  s3, pass
  ecall

  .data
setpoints:
  .word 1500, 900
log:
  .zero 120
