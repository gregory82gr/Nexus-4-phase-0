# Every RV32I instruction, in every operand form the assembler accepts.
  .text
start:
  lui   a0, 0x12345
  lui   t6, 0
  auipc ra, 0xfffff
  jal   ra, start
  jal   target
  jalr  ra, 8(a0)
  jalr  x0, -4(t0)
  jalr  a1, a2, 12
  jalr  t1
  jalr  t2, t3
target:
  beq   a0, a1, start
  bne   s0, s1, target
  blt   t0, t1, forward
  bge   t2, t3, forward
  bltu  a2, a3, start
  bgeu  a4, a5, forward
  lb    a0, -1(sp)
  lh    a1, 2(sp)
  lw    a2, 2047(gp)
  lbu   a3, -2048(tp)
  lhu   a4, 0(s11)
  sb    a0, -1(sp)
  sh    a1, 2(sp)
  sw    a2, 2044(fp)
  addi  a0, a0, -2048
  slti  a1, a2, 7
  sltiu a3, a4, 2047
  xori  a5, a6, -1
  ori   a7, s2, 0x7ff
  andi  s3, s4, 255
  slli  s5, s6, 0
  srli  s7, s8, 31
  srai  s9, s10, 17
forward:
  add   t3, t4, t5
  sub   t6, zero, ra
  sll   x1, x2, x3
  slt   x4, x5, x6
  sltu  x7, x8, x9
  xor   x10, x11, x12
  srl   x13, x14, x15
  sra   x16, x17, x18
  or    x19, x20, x21
  and   x29, x30, x31
  # GNU as accepts an immediate in place of rs2 and assembles the I-type form
  add   a0, a1, 5
  and   a0, a1, -1
  or    a0, a1, 0x10
  xor   a0, a1, 1
  slt   a0, a1, -3
  sltu  a0, a1, 3
  sll   a0, a1, 4
  srl   a0, a1, 5
  sra   a0, a1, 6
  fence
  fence rw, w
  fence iorw, iorw
  fence i, o
  ecall
  ebreak
