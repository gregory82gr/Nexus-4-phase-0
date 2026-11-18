-- @top: swap_signals
-- @stop: 30ns
-- @kernel: required
-- @purpose: Two clocked processes, a <= b and b <= a, swap the values on every rising edge without a temporary,
-- @purpose: whatever order the kernel runs them in: both read the values from before the edge.
-- @expect: .swap_signals(rtl).a = 2 @ 5ns +1
-- @expect: .swap_signals(rtl).b = 1 @ 5ns +1
-- @expect: .swap_signals(rtl).a = 1 @ 15ns +1
-- @expect: .swap_signals(rtl).b = 2 @ 15ns +1
library ieee;
use ieee.std_logic_1164.all;

entity swap_signals is
end entity;

architecture rtl of swap_signals is
  signal clk : std_logic := '0';
  signal a : integer := 1;
  signal b : integer := 2;
begin
  clk <= not clk after 5 ns;

  p1 : process (clk)
  begin
    if rising_edge(clk) then
      a <= b;
    end if;
  end process;

  p2 : process (clk)
  begin
    if rising_edge(clk) then
      b <= a;
    end if;
  end process;
end architecture;
