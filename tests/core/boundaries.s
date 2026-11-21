# The edges of the scratchpads. The data is exactly 16 words, so the simulation gives the core (and the
# model) a 64-byte data scratchpad: 0x10000 to 0x1003f. The code is exactly 32 words, so the instruction
# scratchpad is 128 bytes and the program's last instruction is its last word. The last word, half-word and
# byte of the data scratchpad are read and written; then the last instruction, a load one word past the end
# of the data, must fault.
  .text
  .globl _start
_start:
  la    s0, data              # 2 instructions
  li    t0, 0x1003c           # 2: the last word of the data scratchpad
  li    t1, -2
  sw    t1, 0(t0)
  lw    a0, 0(t0)
  sh    t0, 2(t0)             # the last half-word
  lhu   a1, 2(t0)
  sb    t1, 3(t0)             # the last byte
  lb    a2, 3(t0)
  lbu   a3, 3(t0)
  lw    a4, 60(s0)
  j     last                  # 14 instructions so far
  .space 4 * 16               # never executed
last:
  lw    a5, 60(s0)            # the 31st word
  lw    a6, 64(s0)            # the 32nd and last word of the code; one word past the data: a load access fault
  .data
data:
  .word 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
