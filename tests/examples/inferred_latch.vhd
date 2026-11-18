-- @top: inferred_latch
-- @stop: 60ns
-- @kernel: required
-- @purpose: A combinational process that does not assign its output on every path must remember: a latch.
-- @purpose: A default assignment at the top fixes it. In a clocked process the same missing else is a clock enable.
-- @expect: .inferred_latch(rtl).q_latch = '1' @ 30ns +2
-- @expect: .inferred_latch(rtl).q_comb = '0' @ 30ns +2
-- @expect: .inferred_latch(rtl).q_reg = '1' @ 25ns +1
library ieee;
use ieee.std_logic_1164.all;

entity inferred_latch is
end entity;

architecture rtl of inferred_latch is
  signal clk : std_logic := '0';
  signal en, d : std_logic := '0';
  signal q_latch, q_comb, q_reg : std_logic := '0';
begin
  clk <= not clk after 5 ns;

  -- no else: when en is '0', q_latch keeps its value
  latch : process (all)
  begin
    if en = '1' then
      q_latch <= d;
    end if;
  end process;

  -- a default first: every path assigns q_comb, so it is plain logic
  comb : process (all)
  begin
    q_comb <= '0';
    if en = '1' then
      q_comb <= d;
    end if;
  end process;

  -- clocked: the missing else means "keep the value until the next enabled edge": a register with enable
  reg : process (clk)
  begin
    if rising_edge(clk) then
      if en = '1' then
        q_reg <= d;
      end if;
    end if;
  end process;

  stim : process
  begin
    wait for 12 ns; d <= '1';
    wait for 6 ns;  en <= '1';   -- 18 ns: the latch is transparent
    wait for 12 ns; en <= '0';   -- 30 ns: closed, it holds '1'
    wait for 8 ns;  d <= '0';    -- 38 ns: d changes, the latch does not follow
    wait;
  end process;
end architecture;
