-- @top: resolution_conflict
-- @stop: 10ns
-- @kernel: required
-- @purpose: Two drivers on one std_logic. 'Z' yields to '1'; '1' against '0' resolves to 'X'.
-- @expect: .resolution_conflict(rtl).bus_s = '1' @ 2ns +0
-- @expect: .resolution_conflict(rtl).bus_s = 'X' @ 6ns +0
library ieee;
use ieee.std_logic_1164.all;

entity resolution_conflict is
end entity;

architecture rtl of resolution_conflict is
  signal bus_s : std_logic;
begin
  driver_a : bus_s <= 'Z', '1' after 2 ns;
  driver_b : bus_s <= 'Z', '0' after 6 ns;
end architecture;
