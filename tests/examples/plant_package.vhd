-- @top: plant_package
-- @stop: 50ns
-- @kernel: required
-- @purpose: A package as the shared language of a design: a record type for a sensor reading, a limit, and a
-- @purpose: function that decides what "over the limit" means. An invalid reading counts as over: fail-safe.
-- @expect: .plant_package(rtl).trip = '1' @ 20ns +2
-- @expect: .plant_package(rtl).trip = '0' @ 30ns +2
-- @expect: .plant_package(rtl).trip = '1' @ 40ns +2
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

package plant_pkg is
  subtype temperature_t is unsigned(9 downto 0);           -- degrees C, 0 to 1023
  type reading_t is record
    value : temperature_t;
    valid : std_logic;                                       -- '0': the sensor reports a fault
  end record;
  type readings_t is array (1 to 3) of reading_t;
  constant LIMIT : temperature_t := to_unsigned(600, 10);
  function over_limit(r : reading_t) return std_logic;
  function vote_2oo3(r : readings_t) return std_logic;
end package;

package body plant_pkg is
  function over_limit(r : reading_t) return std_logic is
  begin
    if r.valid /= '1' then
      return '1';                       -- a sensor we cannot trust votes for the trip
    elsif r.value > LIMIT then
      return '1';
    else
      return '0';
    end if;
  end function;

  function vote_2oo3(r : readings_t) return std_logic is
    variable a, b, c : std_logic;
  begin
    a := over_limit(r(1)); b := over_limit(r(2)); c := over_limit(r(3));
    return (a and b) or (a and c) or (b and c);
  end function;
end package body;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.plant_pkg.all;

entity plant_package is
end entity;

architecture rtl of plant_package is
  signal sensors : readings_t := (others => (value => to_unsigned(300, 10), valid => '1'));
  signal trip : std_logic;
begin
  trip <= vote_2oo3(sensors);

  plant : process
  begin
    wait for 10 ns; sensors(1).value <= to_unsigned(650, 10);   -- one sensor over: no trip
    wait for 10 ns; sensors(3).valid <= '0';                    -- a second sensor fails: trip (fail-safe)
    wait for 10 ns; sensors(1).value <= to_unsigned(300, 10);   -- one invalid sensor alone: no trip
    wait for 10 ns; sensors(2).valid <= '0';                    -- two invalid: trip
    wait;
  end process;
end architecture;
