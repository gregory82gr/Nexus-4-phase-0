-- @top: last_assignment_wins
-- @stop: 10ns
-- @kernel: required
-- @purpose: One process run assigns the same signal several times. Every read sees the old value, and each
-- @purpose: assignment replaces the one before it: the loop adds 4 to the variable but only 1 to the signal.
-- @expect: .last_assignment_wins(rtl).s = 1 @ 1ns +1
-- @expect: .last_assignment_wins(rtl).flag = '0' @ 1ns +1
-- @expect-report: v = 4, s = 0
-- @expect-report: one delta cycle later: s = 1
library ieee;
use ieee.std_logic_1164.all;

entity last_assignment_wins is
end entity;

architecture rtl of last_assignment_wins is
  signal s : integer := 0;
  signal flag : std_logic := '0';
begin
  demo : process
    variable v : integer := 0;
  begin
    wait for 1 ns;
    for i in 1 to 4 loop
      v := v + 1;   -- 1, 2, 3, 4
      s <= s + 1;   -- reads the old s every time: schedules 0 + 1, four times
    end loop;
    flag <= '1';
    flag <= '0';    -- replaces the '1' before it was due: flag never becomes '1'
    report "v = " & integer'image(v) & ", s = " & integer'image(s);
    wait for 0 ns;
    report "one delta cycle later: s = " & integer'image(s);
    wait;
  end process;
end architecture;
