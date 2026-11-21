// The NEXUS-4 test environment for the official riscv-tests (https://github.com/riscv-software-src/riscv-tests).
// It replaces their env/p/riscv_test.h: no CSRs, no trap handler, no tohost. A test starts at the
// first instruction of the instruction scratchpad and ends with ecall, which stops the NEXUS-4 core.
// As in riscv-tests, TESTNUM (gp) is 1 when every case passed, and (n << 1) | 1 when case n failed.
#ifndef NEXUS4_RISCV_TEST_H
#define NEXUS4_RISCV_TEST_H

#define RVTEST_RV32U
#define RVTEST_RV64U
#define TESTNUM gp

#define RVTEST_CODE_BEGIN \
        .text; \
        .globl _start; \
_start:

#define RVTEST_CODE_END

#define RVTEST_PASS \
        fence; \
        li TESTNUM, 1; \
        ecall

#define RVTEST_FAIL \
        fence; \
1:      beqz TESTNUM, 1b; \
        sll TESTNUM, TESTNUM, 1; \
        or TESTNUM, TESTNUM, 1; \
        ecall

#define RVTEST_DATA_BEGIN \
        .data; \
        .align 4;

#define RVTEST_DATA_END

#endif
