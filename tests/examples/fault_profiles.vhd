-- @top: fault_profiles
-- @stop: 40ns
-- @kernel: required
-- @purpose: One design, two profiles, chosen by a generic and if-generate: PLANT compares two copies (lockstep) and trips
-- @purpose: on a mismatch; ORBIT votes over three copies (TMR) and keeps working. A bit flip hits copy 1 at 15 ns.
-- @note: GHDL 4.1's trace sometimes leaves out signals declared inside an if-generate with more than one alternative
-- @note: (a GHDL defect: it depends on the alternative and on constant vs generic conditions; --disp-tree crashes).
-- @note: Such signals are compared whenever GHDL shows them, as here; their effects on result and alarm always are.
-- @expect: .fault_profiles(sim).plant_alarm = '1' @ 15ns +3
-- @expect: .fault_profiles(sim).orbit_result = '1' @ 15ns +3
-- @expect: .fault_profiles(sim).orbit_alarm = '1' @ 15ns +3
library ieee;
use ieee.std_logic_1164.all;

entity protected_bit is
  generic (PROFILE : string := "PLANT");
  port (d : in std_logic; upset : in std_logic; q : out std_logic; alarm : out std_logic);
end entity;

architecture rtl of protected_bit is
begin
  plant_or_orbit : if PROFILE = "PLANT" generate
    signal c0, c1 : std_logic;
  begin
    c0 <= d;
    c1 <= d xor upset;                    -- copy 1 takes the bit flip
    q <= c0;
    alarm <= '1' when c0 /= c1 else '0';  -- lockstep comparator: fail-safe, trip
  else generate
    signal c0, c1, c2 : std_logic;
  begin
    c0 <= d;
    c1 <= d xor upset;
    c2 <= d;
    q <= (c0 and c1) or (c0 and c2) or (c1 and c2);  -- majority vote: fail-operational
    alarm <= '1' when c0 /= c1 or c1 /= c2 else '0';
  end generate;
end architecture;

library ieee;
use ieee.std_logic_1164.all;

entity fault_profiles is
end entity;

architecture sim of fault_profiles is
  signal d, upset : std_logic := '0';
  signal plant_result, plant_alarm, orbit_result, orbit_alarm : std_logic;
begin
  plant : entity work.protected_bit generic map (PROFILE => "PLANT") port map (d, upset, plant_result, plant_alarm);
  orbit : entity work.protected_bit generic map (PROFILE => "ORBIT") port map (d, upset, orbit_result, orbit_alarm);

  stim : process
  begin
    wait for 5 ns;  d <= '1';
    wait for 10 ns; upset <= '1';
    wait for 10 ns; upset <= '0';
    wait;
  end process;
end architecture;
