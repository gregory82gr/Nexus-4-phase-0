-- @top: register_inference
-- @stop: 60ns
-- @kernel: required
-- @purpose: In a clocked process, a variable read before it is written holds last edge's value: a register.
-- @purpose: Written first, it is only a wire. Same two statements, opposite order, different hardware.
-- @purpose: Signals do not care about order: every signal assigned on an edge is a register.
-- @expect: .register_inference(rtl).q_two = '1' @ 25ns +1
-- @expect: .register_inference(rtl).q_one = '1' @ 15ns +1
-- @expect: .register_inference(rtl).q_sig = '1' @ 25ns +1
library ieee;
use ieee.std_logic_1164.all;

entity register_inference is
end entity;

architecture rtl of register_inference is
  signal clk : std_logic := '0';
  signal d : std_logic := '0';
  signal q_two, q_one, q_sig : std_logic := '0';
  signal s1 : std_logic := '0';
begin
  clk <= not clk after 5 ns;
  d <= '1' after 12 ns;

  -- read before write: v2 takes v1 from the previous edge, so there are two stages
  two_stages : process (clk)
    variable v1, v2 : std_logic := '0';
  begin
    if rising_edge(clk) then
      v2 := v1;
      v1 := d;
      q_two <= v2;
    end if;
  end process;

  -- write before read: v1 is d of this edge, so only q_one is a register
  one_stage : process (clk)
    variable v1, v2 : std_logic := '0';
  begin
    if rising_edge(clk) then
      v1 := d;
      v2 := v1;
      q_one <= v2;
    end if;
  end process;

  -- signals: the order of the two lines does not matter, both are registers
  signals : process (clk)
  begin
    if rising_edge(clk) then
      q_sig <= s1;
      s1 <= d;
    end if;
  end process;
end architecture;
