-- @top: missing_sensitivity
-- @stop: 40ns
-- @kernel: required
-- @purpose: A combinational process with an incomplete sensitivity list. process (a) never wakes when b changes,
-- @purpose: so y_partial keeps a stale value; process (all) does not. A synthesis tool would build the same gate for both.
-- @expect: .missing_sensitivity(rtl).y_all = '1' @ 20ns +2
-- @expect: .missing_sensitivity(rtl).y_partial = '0' @ 20ns +2
-- @expect: .missing_sensitivity(rtl).y_partial = '1' @ 31ns +2
library ieee;
use ieee.std_logic_1164.all;

entity missing_sensitivity is
end entity;

architecture rtl of missing_sensitivity is
  signal a, b : std_logic := '0';
  signal y_partial, y_all : std_logic;
begin
  partial : process (a)        -- b is missing
  begin
    y_partial <= a and b;
  end process;

  complete : process (all)     -- VHDL-2008: every signal the process reads
  begin
    y_all <= a and b;
  end process;

  stim : process
  begin
    wait for 10 ns; a <= '1';
    wait for 10 ns; b <= '1';   -- y_all follows; y_partial does not wake up
    wait for 10 ns; a <= '0';   -- now partial wakes: a and b = '0', which it already was
    wait for 1 ns;  a <= '1';   -- partial wakes again and finally sees b = '1'
    wait;
  end process;
end architecture;
