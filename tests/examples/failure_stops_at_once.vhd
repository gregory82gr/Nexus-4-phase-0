-- @top: failure_stops_at_once
-- @stop: 20ns
-- @kernel: required
-- @purpose: A report of severity failure stops the simulation at once: the statements after it in the same process
-- @purpose: do not run, and nothing else happens. Error, warning and note are reported and the run goes on.
-- @expect-report: an error
-- @expect-report: still running at 5 ns
-- @expect-report: a failure
-- @expect-no-cycle: 15ns +0
library ieee;
use ieee.std_logic_1164.all;

entity failure_stops_at_once is
end entity;

architecture sim of failure_stops_at_once is
  signal tick : std_logic := '0';
begin
  tick <= '1' after 15 ns;                  -- an event the run never reaches

  process
  begin
    report "an error" severity error;       -- reported; the run goes on
    wait for 5 ns;
    report "still running at 5 ns";
    wait for 5 ns;
    report "a failure" severity failure;    -- the run stops here, at 10 ns
    report "never printed";
    wait;
  end process;
end architecture;
