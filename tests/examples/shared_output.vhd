-- @top: shared_output
-- @stop: 20ns
-- @kernel: required
-- @purpose: Two instances drive one std_logic through their out ports. GHDL creates a transaction for every
-- @purpose: assignment to a signal with several drivers, even one that repeats the current value (D69).
-- @expect: .shared_output(sim).y = '1' @ 3ns +2
-- @expect-report: y was never 'X'
library ieee;
use ieee.std_logic_1164.all;

-- the interface: what the outside world sees
entity voter2oo3 is
  port (a, b, c : in std_logic; y : out std_logic);
end entity;

-- implementation 1: gates
architecture gates of voter2oo3 is
begin
  y <= (a and b) or (a and c) or (b and c);
end architecture;

-- implementation 2: a truth table
architecture table of voter2oo3 is
begin
  process (all)
    variable abc : std_logic_vector(2 downto 0);
  begin
    abc := a & b & c;
    case abc is
      when "011" | "101" | "110" | "111" => y <= '1';
      when others => y <= '0';
    end case;
  end process;
end architecture;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity shared_output is
end entity;

architecture sim of shared_output is
  signal a, b, c : std_logic := '0';
  signal y : std_logic;   -- two drivers: one per instance
begin
  u_gates : entity work.voter2oo3(gates) port map (a => a, b => b, c => c, y => y);
  u_table : entity work.voter2oo3(table) port map (a => a, b => b, c => c, y => y);

  check : process
    variable abc : std_logic_vector(2 downto 0);
  begin
    for i in 0 to 7 loop
      abc := std_logic_vector(to_unsigned(i, 3));
      a <= abc(2); b <= abc(1); c <= abc(0);
      wait for 1 ns;
      assert y /= 'X' report "the two architectures disagree" severity error;
    end loop;
    report "y was never 'X'";
    wait;
  end process;
end architecture;
