# Branches and jumps near the ends of their ranges, where the scattered immediate bits matter most.
# A branch reaches -4096..+4094 bytes, a jal -1 MiB..+1 MiB - 2; without compressed
# instructions the furthest forward targets are +4092 and +1 MiB - 4.
  .text
start:
  beq   a0, a1, fwd_2052      # +2052: bit 11 set, bit 12 clear
  bne   a0, a1, fwd_max       # +4092
  jal   ra, far
  .space 2040
fwd_2052:
  bltu  a0, a1, start         # -2052
  .space 2040
fwd_max:
  nop
back_max:
  nop
  .space 4092
  bge   a2, a3, back_max      # exactly -4096
  jal   x0, start
  .space 0x40000
far:
  jal   x0, start             # back by more than 256 KiB
  ret
