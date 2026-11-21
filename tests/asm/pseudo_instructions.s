# The pseudo-instructions, which GNU as expands to one or two base instructions.
  .text
  .equ LIMIT, 600
  .set BIG, 0x12345678
main:
  nop
  li    a0, 0
  li    a1, -1
  li    a2, 2047
  li    a3, -2048
  li    a4, 2048
  li    a5, -2049
  li    a6, 0x12345000
  li    a7, 0x12345678
  li    t0, 0x7fffffff
  li    t1, 0x80000000
  li    t2, 0xffffffff
  li    t3, 0xfffff800
  li    t4, 0x800
  li    t5, LIMIT
  li    t6, BIG
  li    s0, LIMIT * 2 + 1
  li    zero, 0x12345000      # GNU keeps the addi when rd is x0
  li    x0, 7
  la    a0, table
  lla   a1, table + 8
  mv    a2, a3
  not   a4, a5
  neg   a6, a7
  seqz  t0, t1
  snez  t2, t3
  sltz  t4, t5
  sgtz  t6, s0
loop:
  beqz  a0, loop
  bnez  a1, loop
  blez  a2, done
  bgez  a3, done
  bltz  a4, loop
  bgtz  a5, done
  bgt   a0, a1, loop
  ble   a2, a3, done
  bgtu  a4, a5, loop
  bleu  a6, a7, done
  j     loop
  jal   done
  jr    t0
  ret
  call  helper
  tail  helper
  lw    a0, table
  lbu   a1, table + 3
  sw    a2, table, t0
  sb    a3, table + 1, t1
  # operand forms GNU accepts, found with the official riscv-tests
  jr    t1, -4                # jalr x0, -4(t1)
  jr    8(t1)
  jalr  t1, -4                # jalr ra, -4(t1)
  jalr  a0, t1
  jalr  a0, t1, 12
  call  a0, helper            # through t1, link in a0
  jump  helper, t0            # through t0, no link
  li    a0, 0xffffffffffff8000  # 64-bit constants: GNU evaluates expressions in 64 bits
  li    a1, -0x100000000      # upper 32 bits all 1: the low 32 bits, sign-extended
  li    a2, 0x100000000       # anything else stays 64-bit: lui a2, 0
  li    a3, ((0xffffffff) & ((1 << (32 - 1) << 1) - 1))
done:
  j     done
helper:
  ret

  .data
table:
  .word 1, 2, 3, 4
