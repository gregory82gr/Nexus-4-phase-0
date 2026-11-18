-- @top: signal_vs_variable
-- @stop: 10ns
-- @kernel: required
-- @purpose: Trap #1. A variable changes at once; a signal assignment is only recorded and takes effect one delta cycle later.
-- @expect-report: variable v = 1, signal s = 0
-- @expect-report: after the wait, signal s = 1
-- @expect-event: .signal_vs_variable(rtl).s @ 1ns +1
library ieee;
use ieee.std_logic_1164.all;

entity signal_vs_variable is
end entity;

architecture rtl of signal_vs_variable is
  signal s : integer := 0;
begin
  demo : process
    variable v : integer := 0;
  begin
    wait for 1 ns;
    v := v + 1;
    s <= s + 1;
    report "variable v = " & integer'image(v) & ", signal s = " & integer'image(s);
    wait for 0 ns;  -- one delta cycle later
    report "after the wait, signal s = " & integer'image(s);
    wait;
  end process;
end architecture;
