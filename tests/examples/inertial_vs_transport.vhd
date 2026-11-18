-- @top: inertial_vs_transport
-- @stop: 30ns
-- @kernel: required
-- @purpose: A 1 ns pulse through a 3 ns delay. Inertial delay (the default) swallows it; transport delay passes it on.
-- @expect-event: .inertial_vs_transport(rtl).y_transport @ 8ns +0
-- @expect-event: .inertial_vs_transport(rtl).y_transport @ 9ns +0
-- @expect: .inertial_vs_transport(rtl).y_inertial = '0' @ 9ns +0
-- @expect-event: .inertial_vs_transport(rtl).y_inertial @ 23ns +0
library ieee;
use ieee.std_logic_1164.all;

entity inertial_vs_transport is
end entity;

architecture rtl of inertial_vs_transport is
  signal x           : std_logic := '0';
  signal y_inertial  : std_logic := '0';
  signal y_transport : std_logic := '0';
begin
  y_inertial  <= x after 3 ns;            -- inertial: pulses shorter than 3 ns are rejected
  y_transport <= transport x after 3 ns;  -- transport: every change arrives 3 ns later

  stim : process
  begin
    wait for 5 ns;
    x <= '1';            -- a 1 ns pulse ...
    wait for 1 ns;
    x <= '0';            -- ... is too short for the inertial path
    wait for 14 ns;
    x <= '1';            -- a long pulse passes both paths
    wait;
  end process;
end architecture;
