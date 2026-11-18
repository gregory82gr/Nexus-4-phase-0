-- @top: delta_glitch
-- @stop: 20ns
-- @kernel: required
-- @purpose: A glitch that lasts one delta cycle: x = a xor b, where b follows a one delta later.
-- @purpose: Visible in the delta-cycle view, invisible in the time view, and still an event for the simulator.
-- @expect-event: .delta_glitch(rtl).a @ 10ns +1
-- @expect-event: .delta_glitch(rtl).b @ 10ns +2
-- @expect: .delta_glitch(rtl).x = '1' @ 10ns +2
-- @expect: .delta_glitch(rtl).x = '0' @ 10ns +3
-- @expect-report: x is now '1'
-- @expect-report: x is now '0'
library ieee;
use ieee.std_logic_1164.all;

entity delta_glitch is
end entity;

architecture rtl of delta_glitch is
  signal a, b, x : std_logic := '0';
begin
  b <= a;        -- one delta behind a
  x <= a xor b;  -- '1' only while a and b disagree

  stim : process
  begin
    wait for 10 ns;
    a <= '1';
    wait;
  end process;

  -- a process sensitive to x sees the glitch: it is an event
  watch : process (x)
  begin
    if now > 0 ns then
      report "x is now " & std_logic'image(x);
    end if;
  end process;
end architecture;
