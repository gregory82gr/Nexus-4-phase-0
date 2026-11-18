-- @top: timing_is_not_logic
-- @stop: 60ns
-- @kernel: required
-- @purpose: Two descriptions of "done three clock cycles after start". One uses after 30 ns: correct in simulation,
-- @purpose: and no hardware at all, because synthesis ignores delays. The other counts edges: real hardware.
-- @expect: .timing_is_not_logic(rtl).done_delay = '1' @ 35ns +0
-- @expect: .timing_is_not_logic(rtl).done_count = '1' @ 35ns +1
library ieee;
use ieee.std_logic_1164.all;

entity timing_is_not_logic is
end entity;

architecture rtl of timing_is_not_logic is
  signal clk : std_logic := '0';
  signal start : std_logic := '0';
  signal done_delay, done_count : std_logic := '0';
  signal cycles : natural range 0 to 3 := 0;
begin
  clk <= not clk after 5 ns;
  start <= '1' after 5 ns;

  -- simulation only: a synthesis tool drops "after 30 ns" and connects done_delay to start
  done_delay <= start after 30 ns;

  -- hardware: count three rising edges after start
  counter : process (clk)
  begin
    if rising_edge(clk) then
      if start = '1' and cycles < 3 then
        cycles <= cycles + 1;
      end if;
      if cycles = 3 then
        done_count <= '1';
      end if;
    end if;
  end process;
end architecture;
