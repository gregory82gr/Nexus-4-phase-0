-- @top: wait_forms
-- @stop: 50ns
-- @kernel: required
-- @purpose: The forms of wait: on a signal, until a condition, for a time, and their combination with a timeout.
-- @expect-report: woke on req at 10 ns
-- @expect-report: ack seen
-- @expect-report: timed out waiting for done
library ieee;
use ieee.std_logic_1164.all;

entity wait_forms is
end entity;

architecture rtl of wait_forms is
  signal req, ack, done : std_logic := '0';
begin
  producer : process
  begin
    wait for 10 ns;
    req <= '1';
    wait until ack = '1';
    report "ack seen";
    wait until done = '1' for 15 ns;
    if done /= '1' then
      report "timed out waiting for done" severity warning;
    end if;
    wait;
  end process;

  consumer : process
  begin
    wait on req;
    if now = 10 ns then
      report "woke on req at 10 ns";
    end if;
    ack <= '1' after 2 ns;
    wait;
  end process;
end architecture;
