-- @top: variable_persists
-- @stop: 40ns
-- @kernel: required
-- @purpose: A process variable keeps its value from one activation to the next, like a static local or a field
-- @purpose: of an object. A function's variable starts again from its initial value at every call.
-- @expect: .variable_persists(rtl).edges = 1 @ 5ns +1
-- @expect: .variable_persists(rtl).edges = 4 @ 35ns +1
-- @expect: .variable_persists(rtl).fresh = 1 @ 35ns +1
library ieee;
use ieee.std_logic_1164.all;

entity variable_persists is
end entity;

architecture rtl of variable_persists is
  signal clk : std_logic := '0';
  signal edges : integer := 0;
  signal fresh : integer := 0;

  function count_once return integer is
    variable n : integer := 0;   -- a new n at every call
  begin
    n := n + 1;
    return n;
  end function;
begin
  clk <= not clk after 5 ns;

  counter : process (clk)
    variable n : integer := 0;   -- one n for the whole simulation
  begin
    if rising_edge(clk) then
      n := n + 1;
      edges <= n;
      fresh <= count_once;
    end if;
  end process;
end architecture;
