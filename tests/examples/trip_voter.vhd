-- @top: trip_voter
-- @stop: 50ns
-- @kernel: required
-- @purpose: The two-out-of-three trip vote of a reactor protection channel, twice: as one expression, and as gates
-- @purpose: written in the opposite order. Both follow their inputs at all times; the order of the text does not matter.
-- @expect: .trip_voter(rtl).trip = '1' @ 20ns +2
-- @expect: .trip_voter(rtl).trip_gates = '1' @ 20ns +3
-- @expect: .trip_voter(rtl).trip = '0' @ 40ns +2
library ieee;
use ieee.std_logic_1164.all;

entity trip_voter is
end entity;

architecture rtl of trip_voter is
  -- one bit per pressure sensor: '1' means "over the limit"
  signal s1, s2, s3 : std_logic := '0';
  signal trip, trip_gates : std_logic;
  signal ab, ac, bc : std_logic;
begin
  -- the vote as one expression
  trip <= (s1 and s2) or (s1 and s3) or (s2 and s3);

  -- the same vote as separate gates, written "backwards": the output first, its inputs later
  trip_gates <= ab or ac or bc;
  bc <= s2 and s3;
  ac <= s1 and s3;
  ab <= s1 and s2;

  -- the plant: sensors go over the limit and come back
  plant : process
  begin
    wait for 10 ns; s1 <= '1';             -- one sensor alone: no trip
    wait for 10 ns; s3 <= '1';             -- two of three: trip
    wait for 10 ns; s1 <= '0'; s2 <= '1';  -- still two of three
    wait for 10 ns; s3 <= '0';             -- one again: the vote releases
    wait;
  end process;
end architecture;
