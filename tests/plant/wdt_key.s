# The watchdog's key (D55): a store of any other value to WDT must not restart the watchdog. The program
# restarts it once with the key, then keeps writing 0 to WDT for longer than the watchdog's time; the
# watchdog must trip and stop the core (tools/core-check.mjs runs it with a 60-cycle watchdog).
  .text
  .globl _start
_start:
  li    s0, 0x20000
  li    t0, 0x5AFEC0DE
  sw    t0, 20(s0)            # restart the watchdog with the key
  li    t1, 40
1:
  sw    zero, 20(s0)          # not the key: ignored
  addi  t1, t1, -1
  bnez  t1, 1b
  ecall                       # not reached in PLANT: the watchdog trips first
