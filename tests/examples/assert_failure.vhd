-- @top: assert_failure
-- @stop: 100ns
-- @kernel: required
-- @purpose: A self-checking testbench. An assertion with severity failure stops the simulation at once.
-- @expect-report: check passed at step 1
-- @expect-report: the counter went past 2
-- @expect-no-cycle: 40ns +0
library ieee;
use ieee.std_logic_1164.all;

entity assert_failure is
end entity;

architecture rtl of assert_failure is
  signal step : integer := 0;
begin
  step <= 1 after 10 ns, 2 after 20 ns, 3 after 30 ns, 4 after 40 ns;

  checker : process (step)
  begin
    assert step /= 1 report "check passed at step 1" severity note;
    assert step <= 2 report "the counter went past 2" severity failure;
  end process;
end architecture;
