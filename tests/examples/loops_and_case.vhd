-- @top: loops_and_case
-- @stop: 10ns
-- @kernel: required
-- @purpose: for, while and plain loops with exit and next (also to an outer label), and case on vectors and integer ranges.
-- @expect-report: ones in 10110101: 5
-- @expect-report: first 1 from the right at index 0, from the left at index 7
-- @expect-report: pairs found: 3
-- @expect-report: opcode 0110011 is OP
-- @expect-report: opcode 0000000 is unknown
-- @expect-report: 12 is large
library ieee;
use ieee.std_logic_1164.all;

entity loops_and_case is
end entity;

architecture rtl of loops_and_case is
  type opcodes_t is array (0 to 3) of std_logic_vector(6 downto 0);
  constant OPS : opcodes_t := ("0110011", "0010011", "1101111", "0000000");
begin
  demo : process
    variable v     : std_logic_vector(7 downto 0) := "10110101";
    variable count : natural := 0;
    variable i     : integer;
    variable pairs : natural := 0;
    variable first_right, first_left : integer := -1;
  begin
    -- for over a 'range, with next
    for k in v'range loop
      next when v(k) = '0';
      count := count + 1;
    end loop;
    report "ones in " & to_string(v) & ": " & integer'image(count);

    -- while with exit, scanning from the right
    i := v'low;
    while i <= v'high loop
      if v(i) = '1' then first_right := i; exit; end if;
      i := i + 1;
    end loop;
    -- plain loop with exit when, scanning from the left
    i := v'high;
    loop
      exit when v(i) = '1';
      i := i - 1;
    end loop;
    first_left := i;
    report "first 1 from the right at index " & integer'image(first_right) &
           ", from the left at index " & integer'image(first_left);

    -- nested loops: exit and next to an outer label
    outer : for a in 0 to 5 loop
      for b in 0 to 5 loop
        next outer when a > 3;
        if a + b = 4 and a < b then
          pairs := pairs + 1;
          next outer;
        end if;
        exit outer when pairs = 3;
      end loop;
    end loop outer;
    report "pairs found: " & integer'image(pairs + 1);

    -- case on a vector: RISC-V major opcodes
    for k in OPS'range loop
      case OPS(k) is
        when "0110011" => report "opcode " & to_string(OPS(k)) & " is OP";
        when "0010011" => report "opcode " & to_string(OPS(k)) & " is OP-IMM";
        when "1101111" => report "opcode " & to_string(OPS(k)) & " is JAL";
        when others    => report "opcode " & to_string(OPS(k)) & " is unknown";
      end case;
    end loop;

    -- case on integer ranges
    for n in 0 to 12 loop
      if n = 0 or n = 5 or n = 9 or n = 12 then
        case n is
          when 0 to 3     => report integer'image(n) & " is small";
          when 4 | 5 | 6  => report integer'image(n) & " is medium";
          when others     => report integer'image(n) & " is large";
        end case;
      end if;
    end loop;
    wait;
  end process;
end architecture;
