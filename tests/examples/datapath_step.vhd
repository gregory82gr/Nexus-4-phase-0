-- @top: datapath_step
-- @stop: 100ns
-- @kernel: required
-- @purpose: The bridge to the processor: a register file, an ALU and a program counter, one instruction per clock.
-- @purpose: Operands are read and computed between edges; the result is written back, and the PC advances, at the edge.
-- @expect-report: x1 = 5, x2 = 7, x3 = 12, x4 = -2, x5 = 1, x6 = 24, x0 = 0
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

package dp_pkg is
  type op_t is (OP_ADD, OP_SUB, OP_SLT, OP_SLL);
  type instr_t is record
    op      : op_t;
    rd      : natural range 0 to 7;
    rs1     : natural range 0 to 7;
    rs2     : natural range 0 to 7;
    imm     : integer;
    use_imm : boolean;   -- the I-type form: b comes from imm, not from rs2
  end record;
  type program_t is array (natural range <>) of instr_t;
  function alu(op : op_t; a, b : signed(31 downto 0)) return signed;
end package;

package body dp_pkg is
  function alu(op : op_t; a, b : signed(31 downto 0)) return signed is
  begin
    case op is
      when OP_ADD => return a + b;
      when OP_SUB => return a - b;
      when OP_SLT =>
        if a < b then return to_signed(1, 32); else return to_signed(0, 32); end if;
      when OP_SLL => return shift_left(a, to_integer(unsigned(b(4 downto 0))));
    end case;
  end function;
end package body;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.dp_pkg.all;

entity datapath_step is
end entity;

architecture rtl of datapath_step is
  constant PROG : program_t := (
    (op => OP_ADD, rd => 1, rs1 => 0, rs2 => 0, imm => 5,  use_imm => true),    -- addi x1, x0, 5
    (op => OP_ADD, rd => 2, rs1 => 0, rs2 => 0, imm => 7,  use_imm => true),    -- addi x2, x0, 7
    (op => OP_ADD, rd => 3, rs1 => 1, rs2 => 2, imm => 0,  use_imm => false),   -- add  x3, x1, x2
    (op => OP_SUB, rd => 4, rs1 => 1, rs2 => 2, imm => 0,  use_imm => false),   -- sub  x4, x1, x2
    (op => OP_SLT, rd => 5, rs1 => 4, rs2 => 0, imm => 0,  use_imm => false),   -- slt  x5, x4, x0
    (op => OP_SLL, rd => 6, rs1 => 3, rs2 => 5, imm => 0,  use_imm => false),   -- sll  x6, x3, x5
    (op => OP_ADD, rd => 0, rs1 => 0, rs2 => 0, imm => 99, use_imm => true));   -- addi x0, x0, 99: x0 stays 0

  type regs_t is array (0 to 7) of signed(31 downto 0);
  signal regs : regs_t := (others => (others => '0'));
  signal pc : natural range 0 to 15 := 0;
  signal clk : std_logic := '0';
  signal halted : boolean := false;
  signal a, b, y : signed(31 downto 0);
begin
  clk <= not clk after 5 ns when not halted;

  -- read and execute: combinational, between edges
  a <= regs(PROG(pc).rs1);
  b <= to_signed(PROG(pc).imm, 32) when PROG(pc).use_imm else regs(PROG(pc).rs2);
  y <= alu(PROG(pc).op, a, b);

  -- write back and fetch the next instruction: at the edge
  step : process (clk)
  begin
    if rising_edge(clk) then
      if PROG(pc).rd /= 0 then
        regs(PROG(pc).rd) <= y;
      end if;
      if pc = PROG'high then
        halted <= true;
      else
        pc <= pc + 1;
      end if;
    end if;
  end process;

  dump : process
  begin
    wait until halted;
    report "x1 = " & integer'image(to_integer(regs(1))) & ", x2 = " & integer'image(to_integer(regs(2))) &
           ", x3 = " & integer'image(to_integer(regs(3))) & ", x4 = " & integer'image(to_integer(regs(4))) &
           ", x5 = " & integer'image(to_integer(regs(5))) & ", x6 = " & integer'image(to_integer(regs(6))) &
           ", x0 = " & integer'image(to_integer(regs(0)));
    wait;
  end process;
end architecture;
