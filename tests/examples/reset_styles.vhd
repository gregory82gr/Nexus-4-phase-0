-- @top: reset_styles
-- @stop: 60ns
-- @kernel: required
-- @purpose: Synchronous and asynchronous reset side by side. Reset rises at 22 ns, between two clock edges:
-- @purpose: the asynchronous register clears at once, the synchronous one only at the next rising edge.
-- @expect: .reset_styles(rtl).q_async = 0 @ 22ns +1
-- @expect: .reset_styles(rtl).q_sync = 0 @ 25ns +1
-- @expect: .reset_styles(rtl).q_sync = 1 @ 35ns +1
library ieee;
use ieee.std_logic_1164.all;

entity reset_styles is
end entity;

architecture rtl of reset_styles is
  signal clk : std_logic := '0';
  signal rst : std_logic := '0';
  signal q_sync, q_async : natural := 0;
begin
  clk <= not clk after 5 ns;
  rst <= '1' after 22 ns, '0' after 32 ns;

  -- synchronous reset: rst is only looked at on a rising edge
  sync_reg : process (clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        q_sync <= 0;
      else
        q_sync <= q_sync + 1;
      end if;
    end if;
  end process;

  -- asynchronous reset: rst is in the sensitivity list and wins over the clock
  async_reg : process (clk, rst)
  begin
    if rst = '1' then
      q_async <= 0;
    elsif rising_edge(clk) then
      q_async <= q_async + 1;
    end if;
  end process;
end architecture;
