-- @top: hierarchy_ports
-- @stop: 5ns
-- @kernel: required
-- @purpose: Hierarchy. Entity and component instantiation, generics, positional and named port maps, open outputs,
-- @purpose: default and constant inputs, and a for-generate. A port connected to a signal changes in the same delta cycle.
-- @expect-event: .hierarchy_ports(sim).u1@cell(rtl).a @ 1ns +1
-- @expect-event: .hierarchy_ports(sim).x @ 1ns +1
-- @expect-event: .hierarchy_ports(sim).r @ 1ns +3
-- @expect-event: .hierarchy_ports(sim).u1@cell(rtl).y @ 1ns +3
-- @expect: .hierarchy_ports(sim).u2@cell(rtl).b = '1' @ 1ns +1
-- @expect-event: .hierarchy_ports(sim).g(1).q @ 1ns +2
library ieee;
use ieee.std_logic_1164.all;

entity cell is
  generic (INV : boolean := false);
  port (a : in std_logic; b : in std_logic := '1'; y : out std_logic; z : out std_logic);
end entity;

architecture rtl of cell is
  signal t : std_logic;
begin
  t <= a and b;
  y <= not t when INV else t;
  z <= a;
end architecture;

library ieee;
use ieee.std_logic_1164.all;

entity hierarchy_ports is
end entity;

architecture sim of hierarchy_ports is
  signal x, r, s : std_logic := '0';
  signal v : std_logic_vector(1 downto 0);
  component cell is
    generic (INV : boolean := false);
    port (a : in std_logic; b : in std_logic := '1'; y : out std_logic; z : out std_logic);
  end component;
begin
  u1 : entity work.cell generic map (INV => true) port map (a => x, y => r, z => open);
  u2 : cell port map (x, '1', s, open);
  g : for i in 0 to 1 generate
    signal q : std_logic;
  begin
    q <= x;
    v(i) <= q;
  end generate;

  stim : process
  begin
    wait for 1 ns;
    x <= '1';
    wait;
  end process;
end architecture;
