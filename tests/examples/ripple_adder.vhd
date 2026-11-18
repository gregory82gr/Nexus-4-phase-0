-- @top: ripple_adder
-- @stop: 30ns
-- @kernel: required
-- @purpose: A ripple-carry adder of generic width, built by a for-generate from one full-adder entity. The carry
-- @purpose: ripples from bit to bit, one delta cycle per stage: the sum shows wrong values for several delta cycles.
-- @expect: .ripple_adder(sim).sum(0) = '0' @ 10ns +2
-- @expect: .ripple_adder(sim).sum(7) = '1' @ 10ns +2
-- @expect: .ripple_adder(sim).sum(7) = '0' @ 10ns +9
-- @expect: .ripple_adder(sim).cout = '1' @ 10ns +10
-- @expect-report: 255 + 1 = 0 with carry out '1'
library ieee;
use ieee.std_logic_1164.all;

entity full_adder is
  port (a, b, cin : in std_logic; s, cout : out std_logic);
end entity;

architecture rtl of full_adder is
begin
  s    <= a xor b xor cin;
  cout <= (a and b) or (a and cin) or (b and cin);
end architecture;

library ieee;
use ieee.std_logic_1164.all;

entity adder_n is
  generic (N : positive := 4);
  port (a, b : in std_logic_vector(N - 1 downto 0); cin : in std_logic;
        sum : out std_logic_vector(N - 1 downto 0); cout : out std_logic);
end entity;

architecture structural of adder_n is
  signal c : std_logic_vector(N downto 0);   -- c(i) is the carry into bit i
begin
  c(0) <= cin;
  bits : for i in 0 to N - 1 generate
    fa : entity work.full_adder port map (a => a(i), b => b(i), cin => c(i), s => sum(i), cout => c(i + 1));
  end generate;
  cout <= c(N);
end architecture;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity ripple_adder is
end entity;

architecture sim of ripple_adder is
  signal a, b, sum : std_logic_vector(7 downto 0) := (others => '0');
  signal cout : std_logic;
begin
  dut : entity work.adder_n generic map (N => 8) port map (a => a, b => b, cin => '0', sum => sum, cout => cout);

  stim : process
  begin
    wait for 10 ns;
    a <= x"FF"; b <= x"01";   -- the worst case: the carry ripples through all eight bits
    wait for 5 ns;
    report "255 + 1 = " & integer'image(to_integer(unsigned(sum))) & " with carry out " & std_logic'image(cout);
    wait;
  end process;
end architecture;
