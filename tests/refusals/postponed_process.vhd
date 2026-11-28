-- @top: postponed_process
-- @stop: 5ns
-- @kernel-refuses: unsupported: postponed processes
-- @ghdl: accepts
-- @purpose: A postponed process runs only in the last delta cycle of a time step (LRM 14.7.5.3). The kernel has no
-- @purpose: such step: not supported.
library ieee;
use ieee.std_logic_1164.all;

entity postponed_process is
end entity;

architecture sim of postponed_process is
  signal a, b : std_logic := '0';
begin
  a <= '1' after 1 ns;
  b <= a;

  settled : postponed process (a, b)
  begin
    report "a = " & std_logic'image(a) & ", b = " & std_logic'image(b);
  end process;
end architecture;
