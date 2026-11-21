# Data directives, alignment, strings, expressions, %hi / %lo and %pcrel_hi / %pcrel_lo.
  .text
  .globl entry
entry:
  lui   a0, %hi(message)
  addi  a0, a0, %lo(message)
  lw    a1, %lo(counter)(a0)
1:
  auipc a2, %pcrel_hi(counter)
  lw    a3, %pcrel_lo(1b)(a2)
  sw    a3, %pcrel_lo(1b)(a2)
  j     1b
  j     2f
  .align 3
2:
  addi  a0, a0, (3 << 4) | 1
  addi  a1, a1, 'A'
  addi  a2, a2, '\n'
  addi  a3, a3, -(5 - 7) * 3
  addi  a4, a4, 100 / 7 + 100 % 7
  addi  a5, a5, ~0
  addi  a6, a6, 0b1010
  addi  a7, a7, 017
  .balign 16
  .align 4, , 4             # skipped: more than 4 bytes of padding would be needed
  ecall

  .data
message:
  .asciz "NEXUS-4\tready\n"
  .ascii "ab", "c"
  .string "x"
  .align 2
counter:
  .word 0
  .half 0x1234, -1
  .byte 1, 2, 255, -128
  .2byte 7
  .4byte counter, message + 4
  .zero 3
  .space 2, 0xaa
  .byte
  .p2align 3, 0x55
words:
  .word words - counter, . - message
  .rept 3                   # repeated blocks, nested
  .byte 0x11
  .rept 2
  .half 0x2233
  .endr
  .endr
  .equ COUNT, 2
  .rept COUNT * 2
  .byte COUNT
  .endr
  .word 0x100000000         # truncated with a warning, as GNU does
  .byte -129, 300
  .p2align 4                # the end of .data is not padded to its alignment; the end of .text is
  .byte 0x77
