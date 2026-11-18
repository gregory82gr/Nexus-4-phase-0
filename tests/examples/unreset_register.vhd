-- @top: unreset_register
-- @stop: 40ns
-- @purpose: The "forgot the reset" trap. A counter register without reset starts at 'U' and never recovers.
-- @note: From the second edge on, q <= q + 1 assigns the value q already has. The LRM still makes q active
-- @note: in a cycle 15ns +1, but nothing in the subset can observe a transaction without an event, so GHDL
-- @note: omits that cycle. The kernel keeps it in its own log; the comparison drops it (decision D31).
-- @expect: .unreset_register(rtl).q(0) = 'X' @ 5ns +1
-- @expect: .unreset_register(rtl).q(7) = 'X' @ 35ns +0
-- @expect-no-cycle: 15ns +1
-- @expect-report: q = XX
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity unreset_register is
end entity;

architecture rtl of unreset_register is
  signal clk : std_logic := '0';
  signal q   : unsigned(7 downto 0);  -- no initial value, no reset: starts as "UUUUUUUU"
begin
  clk <= not clk after 5 ns;

  counter : process (clk)
  begin
    if rising_edge(clk) then
      report "q = " & to_hstring(q);
      q <= q + 1;  -- 'U' + 1 gives all 'X', and 'X' + 1 gives all 'X' again
    end if;
  end process;
end architecture;
