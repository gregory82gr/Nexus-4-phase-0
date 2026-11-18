-- @top: composite_trace
-- @stop: 3ns
-- @purpose: Calibration. Composite signals appear in the trace as scalar subelements.
-- @expect-event: .composite_trace(rtl).v(2) @ 0fs +0
-- @expect: .composite_trace(rtl).v(3) = 'U' @ 0fs +0
-- @expect: .composite_trace(rtl).st = run @ 0fs +0
-- @expect: .composite_trace(rtl).r.n = 5 @ 0fs +0
-- @expect-event: .composite_trace(rtl).m(1)(0) @ 0fs +0
-- @expect: .composite_trace(rtl).i = 42 @ 0fs +0
-- @expect-event: .composite_trace(rtl).u(0) @ 2ns +1
-- @expect: .composite_trace(rtl).z = 'H' @ 2ns +1
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity composite_trace is
end entity;

architecture rtl of composite_trace is
  type state_t is (IDLE, RUN);
  type rec_t is record
    f : std_logic;
    n : integer range 0 to 7;
  end record;
  type mem_t is array (0 to 1) of std_logic_vector(1 downto 0);

  signal v  : std_logic_vector(3 downto 0) := "UX01";
  signal u  : unsigned(1 downto 0) := "00";
  signal st : state_t := IDLE;
  signal r  : rec_t := ('0', 0);
  signal m  : mem_t := (others => "00");
  signal i  : integer := 0;
  signal z  : std_logic := 'Z';
begin
  stim : process
  begin
    v(2) <= '1';
    st <= RUN;
    r.n <= 5;
    m(1) <= "11";
    i <= 42;
    wait for 2 ns;
    u <= u + 1;
    z <= 'H';
    wait;
  end process;
end architecture;
