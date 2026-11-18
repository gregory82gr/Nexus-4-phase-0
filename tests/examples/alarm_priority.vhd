-- @top: alarm_priority
-- @stop: 50ns
-- @kernel: required
-- @purpose: when/else is a priority chain: the first true condition wins. with/select is a table: exactly one
-- @purpose: choice matches, and the choices must cover every value. An annunciator for a plant, both ways.
-- @expect: .alarm_priority(rtl).level(1) = '1' @ 20ns +2
-- @expect: .alarm_priority(rtl).level(0) = '0' @ 20ns +2
-- @expect: .alarm_priority(rtl).level(0) = '1' @ 30ns +2
-- @expect: .alarm_priority(rtl).lamp(2) = '1' @ 30ns +3
library ieee;
use ieee.std_logic_1164.all;

entity alarm_priority is
end entity;

architecture rtl of alarm_priority is
  signal warn, high, trip : std_logic := '0';
  signal level : std_logic_vector(1 downto 0);
  signal lamp : std_logic_vector(2 downto 0);  -- red, amber, green
begin
  -- priority: trip beats high, high beats warn
  level <= "11" when trip = '1' else
           "10" when high = '1' else
           "01" when warn = '1' else
           "00";

  -- a table: one lamp per level, every value of level covered
  with level select
    lamp <= "100" when "11",
            "010" when "10" | "01",
            "001" when "00",
            "111" when others;   -- 'U', 'X' and the other metavalues: all lamps on

  plant : process
  begin
    wait for 10 ns; warn <= '1';
    wait for 10 ns; high <= '1';   -- warn is still '1': high wins
    wait for 10 ns; trip <= '1';   -- all three: trip wins
    wait for 10 ns; trip <= '0'; high <= '0'; warn <= '0';
    wait;
  end process;
end architecture;
