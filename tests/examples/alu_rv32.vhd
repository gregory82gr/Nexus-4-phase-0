-- @top: alu_rv32
-- @stop: 200ns
-- @kernel: required
-- @purpose: The arithmetic-logic unit of an RV32I processor: ten operations on 32-bit operands, with numeric_std doing
-- @purpose: the arithmetic. A table-driven testbench checks each operation, including the signed and unsigned traps.
-- @expect-report: ALU: 12 vectors, 0 errors
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

package alu_pkg is
  type alu_op_t is (OP_ADD, OP_SUB, OP_AND, OP_OR, OP_XOR, OP_SLT, OP_SLTU, OP_SLL, OP_SRL, OP_SRA);
end package;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.alu_pkg.all;

entity alu is
  port (op : in alu_op_t; a, b : in std_logic_vector(31 downto 0); y : out std_logic_vector(31 downto 0));
end entity;

architecture rtl of alu is
begin
  process (all)
    variable shamt : natural range 0 to 31;
  begin
    shamt := to_integer(unsigned(b(4 downto 0)));   -- RISC-V uses only the low five bits
    case op is
      when OP_ADD  => y <= std_logic_vector(unsigned(a) + unsigned(b));
      when OP_SUB  => y <= std_logic_vector(unsigned(a) - unsigned(b));
      when OP_AND  => y <= a and b;
      when OP_OR   => y <= a or b;
      when OP_XOR  => y <= a xor b;
      when OP_SLT  => if signed(a) < signed(b) then y <= x"00000001"; else y <= x"00000000"; end if;
      when OP_SLTU => if unsigned(a) < unsigned(b) then y <= x"00000001"; else y <= x"00000000"; end if;
      when OP_SLL  => y <= std_logic_vector(shift_left(unsigned(a), shamt));
      when OP_SRL  => y <= std_logic_vector(shift_right(unsigned(a), shamt));
      when OP_SRA  => y <= std_logic_vector(shift_right(signed(a), shamt));
    end case;
  end process;
end architecture;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.alu_pkg.all;

entity alu_rv32 is
end entity;

architecture sim of alu_rv32 is
  signal op : alu_op_t := OP_ADD;
  signal a, b, y : std_logic_vector(31 downto 0) := (others => '0');

  type vector_t is record
    op : alu_op_t;
    a, b, y : std_logic_vector(31 downto 0);
  end record;
  type vectors_t is array (natural range <>) of vector_t;
  constant VECTORS : vectors_t := (
    (OP_ADD,  x"00000005", x"00000007", x"0000000C"),
    (OP_ADD,  x"FFFFFFFF", x"00000001", x"00000000"),   -- wraps around, no flag
    (OP_SUB,  x"00000003", x"00000005", x"FFFFFFFE"),   -- 3 - 5 = -2
    (OP_AND,  x"F0F0F0F0", x"FF00FF00", x"F000F000"),
    (OP_OR,   x"F0F0F0F0", x"0F0F0F0F", x"FFFFFFFF"),
    (OP_XOR,  x"AAAAAAAA", x"FFFFFFFF", x"55555555"),
    (OP_SLT,  x"FFFFFFFF", x"00000001", x"00000001"),   -- -1 < 1 as signed
    (OP_SLTU, x"FFFFFFFF", x"00000001", x"00000000"),   -- 4294967295 < 1 is false
    (OP_SLL,  x"00000001", x"00000004", x"00000010"),
    (OP_SLL,  x"00000001", x"00000024", x"00000010"),   -- shift by 36: only the low 5 bits count
    (OP_SRL,  x"80000000", x"0000001F", x"00000001"),
    (OP_SRA,  x"80000000", x"0000001F", x"FFFFFFFF"));  -- arithmetic shift keeps the sign
begin
  dut : entity work.alu port map (op => op, a => a, b => b, y => y);

  test : process
    variable errors : natural := 0;
  begin
    for i in VECTORS'range loop
      op <= VECTORS(i).op; a <= VECTORS(i).a; b <= VECTORS(i).b;
      wait for 10 ns;
      if y /= VECTORS(i).y then
        errors := errors + 1;
        report alu_op_t'image(VECTORS(i).op) & " " & to_hstring(a) & ", " & to_hstring(b) & " gave " & to_hstring(y) &
               ", expected " & to_hstring(VECTORS(i).y) severity error;
      end if;
    end loop;
    report "ALU: " & integer'image(VECTORS'length) & " vectors, " & integer'image(errors) & " errors";
    wait;
  end process;
end architecture;
