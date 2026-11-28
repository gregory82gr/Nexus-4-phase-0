-- @top: attribute_in_wait
-- @stop: 5ns
-- @kernel-refuses: unsupported: attribute 'transaction in a sensitivity list
-- @ghdl: accepts
-- @purpose: s'transaction is an implicit signal (LRM 16.2), legal in a wait statement and in a sensitivity list. The
-- @purpose: kernel has no implicit signals, so it must say "not supported", not that the design is wrong (D73).
library ieee;
use ieee.std_logic_1164.all;

entity attribute_in_wait is
end entity;

architecture sim of attribute_in_wait is
  signal s : std_logic := '0';
begin
  s <= '1' after 1 ns;

  watcher : process
  begin
    wait on s'transaction;
    report "s had a transaction";
    wait;
  end process;
end architecture;
