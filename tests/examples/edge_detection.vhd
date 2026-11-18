-- @top: edge_detection
-- @stop: 120ns
-- @kernel: required
-- @purpose: rising_edge(clk) versus the old idiom clk'event and clk = '1'. They differ when the clock comes from 'X', 'Z' or 'U':
-- @purpose: rising_edge only counts a change from '0' or 'L' to '1' or 'H'.
-- @expect: .edge_detection(rtl).n_rising = 3 @ 110ns +1
-- @expect: .edge_detection(rtl).n_event_eq_1 = 5 @ 110ns +1
-- @expect: .edge_detection(rtl).n_falling = 3 @ 110ns +1
library ieee;
use ieee.std_logic_1164.all;

entity edge_detection is
end entity;

architecture rtl of edge_detection is
  signal clk          : std_logic := 'U';
  signal n_rising     : natural := 0;
  signal n_event_eq_1 : natural := 0;
  signal n_falling    : natural := 0;
begin
  -- U→1  1→0  0→1  1→X  X→1  1→Z  Z→1  1→L  L→H  H→0  0→1
  clk <= '1' after 10 ns, '0' after 20 ns, '1' after 30 ns, 'X' after 40 ns, '1' after 50 ns,
         'Z' after 60 ns, '1' after 70 ns, 'L' after 80 ns, 'H' after 90 ns, '0' after 100 ns, '1' after 110 ns;

  count_rising : process (clk)
  begin
    if rising_edge(clk) then
      n_rising <= n_rising + 1;
    end if;
  end process;

  count_old_idiom : process (clk)
  begin
    if clk'event and clk = '1' then
      n_event_eq_1 <= n_event_eq_1 + 1;
    end if;
  end process;

  count_falling : process (clk)
  begin
    if falling_edge(clk) then
      n_falling <= n_falling + 1;
    end if;
  end process;
end architecture;
