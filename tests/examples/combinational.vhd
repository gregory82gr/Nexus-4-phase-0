-- @top: combinational
-- @stop: 40ns
-- @kernel: required
-- @purpose: Combinational logic three ways: process(all) with if/elsif, a conditional concurrent assignment, and a gate. Each output follows its inputs one delta cycle later.
-- @expect: .combinational(rtl).y_proc = '1' @ 10ns +2
-- @expect: .combinational(rtl).y_cond = '1' @ 10ns +2
-- @expect: .combinational(rtl).y_gate = 'X' @ 30ns +2
library ieee;
use ieee.std_logic_1164.all;

entity combinational is
end entity;

architecture rtl of combinational is
  signal a, b, sel : std_logic := '0';
  signal y_proc, y_cond, y_gate : std_logic;
begin
  mux_proc : process (all)
  begin
    if sel = '0' then
      y_proc <= a;
    elsif sel = '1' then
      y_proc <= b;
    else
      y_proc <= 'X';
    end if;
  end process;

  y_cond <= a when sel = '0' else b when sel = '1' else 'X';

  y_gate <= (a and not sel) or (b and sel);

  stim : process
  begin
    wait for 10 ns; a <= '1';
    wait for 10 ns; sel <= '1';
    wait for 10 ns; sel <= 'Z';  -- an undriven select: every form shows the uncertainty
    wait;
  end process;
end architecture;
