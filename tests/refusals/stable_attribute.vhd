-- @top: stable_attribute
-- @stop: 5ns
-- @kernel-refuses: unsupported: attribute 'stable
-- @ghdl: accepts
-- @purpose: s'stable(t) is an implicit signal, updated in a step of the simulation cycle (LRM 14.7.5.3) that the
-- @purpose: kernel does not have: not supported.
library ieee;
use ieee.std_logic_1164.all;

entity stable_attribute is
end entity;

architecture sim of stable_attribute is
  signal s : std_logic := '0';
begin
  s <= '1' after 1 ns;

  check : process
  begin
    wait for 2 ns;
    assert not s'stable(2 ns) report "s changed in the last 2 ns" severity note;
    wait;
  end process;
end architecture;
