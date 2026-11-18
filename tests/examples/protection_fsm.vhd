-- @top: protection_fsm
-- @stop: 200ns
-- @kernel: required
-- @purpose: A reactor protection channel as a state machine (the states of an aggregate, in hardware).
-- @purpose: Two consecutive over-temperature samples trip the reactor; only a manual reset in TRIPPED leaves it.
-- @expect: .protection_fsm(rtl).state = alarm @ 35ns +1
-- @expect: .protection_fsm(rtl).state = tripped @ 45ns +1
-- @expect: .protection_fsm(rtl).trip = '1' @ 45ns +2
-- @expect: .protection_fsm(rtl).state = normal @ 115ns +1
-- @expect: .protection_fsm(rtl).trip = '0' @ 115ns +2
-- @expect-report: TRIP at 45 ns
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity protection_fsm is
end entity;

architecture rtl of protection_fsm is
  type state_t is (NORMAL, ALARM, TRIPPED);
  constant LIMIT : unsigned(9 downto 0) := to_unsigned(600, 10);  -- degrees C

  signal clk         : std_logic := '0';
  signal temperature : unsigned(9 downto 0) := to_unsigned(300, 10);
  signal reset_cmd   : std_logic := '0';
  signal state       : state_t := NORMAL;
  signal trip        : std_logic;
begin
  clk <= not clk after 5 ns;

  fsm : process (clk)
  begin
    if rising_edge(clk) then
      case state is
        when NORMAL =>
          if temperature > LIMIT then
            state <= ALARM;
          end if;
        when ALARM =>
          if temperature > LIMIT then
            state <= TRIPPED;
            report "TRIP at " & integer'image(now / 1 ns) & " ns";
          else
            state <= NORMAL;
          end if;
        when TRIPPED =>
          if reset_cmd = '1' and temperature <= LIMIT then
            state <= NORMAL;
          end if;
      end case;
    end if;
  end process;

  trip <= '1' when state = TRIPPED else '0';

  plant : process
  begin
    wait for 30 ns; temperature <= to_unsigned(650, 10);
    wait for 60 ns; temperature <= to_unsigned(400, 10);
    wait for 20 ns; reset_cmd <= '1';
    wait for 20 ns; reset_cmd <= '0';
    wait;
  end process;
end architecture;
