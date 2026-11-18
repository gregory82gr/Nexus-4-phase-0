-- @top: fsm_safe_recovery
-- @stop: 80ns
-- @kernel: required
-- @purpose: A state machine with an explicit encoding: three states use three of the four codes of two bits.
-- @purpose: A radiation upset flips the state into the unused code "11"; "when others" sends the machine to SAFE.
-- @expect: .fsm_safe_recovery(rtl).state(0) = '1' @ 35ns +1
-- @expect: .fsm_safe_recovery(rtl).state(1) = '1' @ 35ns +1
-- @expect: .fsm_safe_recovery(rtl).state(0) = '0' @ 45ns +1
-- @expect-report: illegal state 11: going to SAFE
library ieee;
use ieee.std_logic_1164.all;

entity fsm_safe_recovery is
end entity;

architecture rtl of fsm_safe_recovery is
  constant IDLE : std_logic_vector(1 downto 0) := "00";
  constant RUN  : std_logic_vector(1 downto 0) := "01";
  constant SAFE : std_logic_vector(1 downto 0) := "10";
  -- "11" is not a state

  signal clk   : std_logic := '0';
  signal start : std_logic := '0';
  signal seu   : std_logic := '0';   -- the testbench's model of a single-event upset in the state register
  signal state : std_logic_vector(1 downto 0) := IDLE;
begin
  clk <= not clk after 5 ns;

  fsm : process (clk)
  begin
    if rising_edge(clk) then
      if seu = '1' then
        state <= state xor "10";     -- the upset flips the high bit
      else
        case state is
          when IDLE => if start = '1' then state <= RUN; end if;
          when RUN  => null;
          when SAFE => null;
          when others =>
            report "illegal state " & to_string(state) & ": going to SAFE";
            state <= SAFE;
        end case;
      end if;
    end if;
  end process;

  stim : process
  begin
    wait for 12 ns; start <= '1';
    wait for 10 ns; start <= '0';
    wait for 10 ns; seu <= '1';      -- one edge with an upset: RUN "01" becomes "11"
    wait for 10 ns; seu <= '0';
    wait;
  end process;
end architecture;
