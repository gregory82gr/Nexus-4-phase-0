-- @top: wired_bus
-- @stop: 50ns
-- @kernel: required
-- @purpose: The nine values at work on one wire: a weak pull-up 'H' and two open-drain devices that drive
-- @purpose: '0' or let go with 'Z'. Strong beats weak; two weak values that disagree give 'W'; to_x01 reads it.
-- @expect: .wired_bus(rtl).line = 'H' @ 0ns +0
-- @expect: .wired_bus(rtl).line = '0' @ 10ns +0
-- @expect: .wired_bus(rtl).weak_fight = 'W' @ 30ns +0
library ieee;
use ieee.std_logic_1164.all;

entity wired_bus is
end entity;

architecture rtl of wired_bus is
  signal line : std_logic;        -- three drivers: the pull-up and two devices
  signal weak_fight : std_logic;  -- two weak drivers that disagree
  signal seen : std_logic;        -- what a reader makes of the line
begin
  pull_up : line <= 'H';
  dev_a   : line <= 'Z', '0' after 10 ns, 'Z' after 20 ns;
  dev_b   : line <= 'Z', '0' after 15 ns, 'Z' after 40 ns;

  weak_1 : weak_fight <= 'Z', 'H' after 30 ns;
  weak_2 : weak_fight <= 'Z', 'L' after 30 ns;

  seen <= to_x01(line);
end architecture;
