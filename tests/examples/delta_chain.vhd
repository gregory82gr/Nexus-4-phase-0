-- @top: delta_chain
-- @stop: 2ns
-- @purpose: A zero-delay chain. Each concurrent assignment adds one delta cycle.
-- @expect-event: .delta_chain(rtl).a1 @ 1ns +1
-- @expect-event: .delta_chain(rtl).b1 @ 1ns +2
-- @expect-event: .delta_chain(rtl).c1 @ 1ns +3
-- @expect: .delta_chain(rtl).c1 = '1' @ 1ns +3
library ieee;
use ieee.std_logic_1164.all;

entity delta_chain is
end entity;

architecture rtl of delta_chain is
  signal a1, b1, c1 : std_logic := '0';
begin
  b1 <= a1;  -- one delta behind a1
  c1 <= b1;  -- two deltas behind a1

  stim : process
  begin
    wait for 1 ns;
    a1 <= '1';
    wait;
  end process;
end architecture;
