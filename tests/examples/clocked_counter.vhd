-- @top: clocked_counter
-- @stop: 60ns
-- @kernel: required
-- @purpose: A clocked process with a synchronous reset. The counter only moves on rising edges once reset is released.
-- @expect: .clocked_counter(rtl).count = 0 @ 20ns +0
-- @expect-no-cycle: 15ns +1
-- @expect: .clocked_counter(rtl).count = 1 @ 25ns +1
-- @expect: .clocked_counter(rtl).count = 3 @ 45ns +1
-- @expect-event: .clocked_counter(rtl).toggle @ 10ns +1
library ieee;
use ieee.std_logic_1164.all;

entity clocked_counter is
end entity;

architecture rtl of clocked_counter is
  signal clk    : std_logic := '0';
  signal rst    : std_logic := '1';
  signal count  : natural := 0;
  signal toggle : std_logic := '0';
begin
  clk <= not clk after 5 ns;
  rst <= '0' after 20 ns;

  counter : process (clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        count <= 0;
      else
        count <= count + 1;
      end if;
    end if;
  end process;

  on_falling : process (clk)
  begin
    if falling_edge(clk) then
      toggle <= not toggle;
    end if;
  end process;
end architecture;
