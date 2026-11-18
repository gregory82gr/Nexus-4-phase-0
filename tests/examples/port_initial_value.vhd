-- @top: port_initial_value
-- @stop: 30ns
-- @kernel: required
-- @purpose: A trap at the boundary of an entity: q_tb is declared with := '0', but it is driven by the out port of a
-- @purpose: register, and the port's driver starts from 'U'. So q_tb is 'U' until the first clock edge.
-- @expect: .port_initial_value(sim).q_tb = 'U' @ 5ns +0
-- @expect: .port_initial_value(sim).q_tb = '1' @ 5ns +1
library ieee;
use ieee.std_logic_1164.all;

entity reg1 is
  port (clk, d : in std_logic; q : out std_logic);
end entity;

architecture rtl of reg1 is
begin
  process (clk)
  begin
    if rising_edge(clk) then
      q <= d;
    end if;
  end process;
end architecture;

library ieee;
use ieee.std_logic_1164.all;

entity port_initial_value is
end entity;

architecture sim of port_initial_value is
  signal clk : std_logic := '0';
  signal d : std_logic := '1';
  signal q_tb : std_logic := '0';   -- this '0' never shows: the port's driver decides
begin
  clk <= not clk after 5 ns;
  u_reg : entity work.reg1 port map (clk => clk, d => d, q => q_tb);
end architecture;
