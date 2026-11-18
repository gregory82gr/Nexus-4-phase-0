-- @top: aggregates_slices
-- @stop: 20ns
-- @kernel: required
-- @purpose: Aggregates (positional, named, others, records), bit-string literals, slices as targets and sources,
-- @purpose: and concatenation used as a shift register.
-- @expect: .aggregates_slices(rtl).word(7) = '1' @ 1ns +1
-- @expect: .aggregates_slices(rtl).cfg.mode = run @ 1ns +1
-- @expect: .aggregates_slices(rtl).shreg(0) = '1' @ 15ns +1
-- @expect-report: word = 10100101, nibble swap = 01011010
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity aggregates_slices is
end entity;

architecture rtl of aggregates_slices is
  type mode_t is (OFF, RUN, TEST);
  type cfg_t is record
    mode    : mode_t;
    channel : natural range 0 to 7;
    mask    : std_logic_vector(3 downto 0);
  end record;
  signal word  : std_logic_vector(7 downto 0) := (others => '0');
  signal cfg   : cfg_t := (mode => OFF, channel => 0, mask => "0000");
  signal shreg : std_logic_vector(3 downto 0) := "0000";
  signal clk   : std_logic := '0';
begin
  clk <= not clk after 5 ns;

  shifter : process (clk)
  begin
    if rising_edge(clk) then
      shreg <= shreg(2 downto 0) & '1';
    end if;
  end process;

  stim : process
    variable w : std_logic_vector(7 downto 0);
  begin
    wait for 1 ns;
    word(7 downto 4) <= x"A";
    word(3 downto 0) <= (0 | 2 => '1', others => '0');
    cfg <= (RUN, 5, mask => "1010");
    wait for 0 ns;
    w := word;
    w := w(3 downto 0) & w(7 downto 4);
    report "word = " & to_string(word) & ", nibble swap = " & to_string(w);
    cfg.channel <= cfg.channel + 1;
    wait;
  end process;
end architecture;
