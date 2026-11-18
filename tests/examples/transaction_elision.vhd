-- @top: transaction_elision
-- @stop: 10ns
-- @kernel: required
-- @purpose: Calibration of decision D31. A transaction that does not change a value is visible as "active" in GHDL's trace,
-- @purpose: except for one case GHDL leaves out because nothing in the subset could observe it.
-- @note: Left out by GHDL: an inertial assignment with one zero-delay element, equal to the driver's value, nothing pending (s0, s5).
-- @note: Kept by GHDL: a delay (s1), a pending transaction (s2), a second waveform element (s3), transport (s4).
-- @expect-event: .transaction_elision(rtl).s3 @ 3ns +0
-- @expect-no-cycle: 1ns +2
library ieee;
use ieee.std_logic_1164.all;

entity transaction_elision is
end entity;

architecture rtl of transaction_elision is
  signal s0, s1, s2, s3, s4, s5 : std_logic := '0';
begin
  stim : process
  begin
    wait for 1 ns;
    s0 <= '0';                 -- left out: zero delay, same value, nothing pending
    s1 <= '0' after 1 ns;      -- kept: a delay
    s3 <= '0', '1' after 2 ns; -- kept: a second waveform element
    s4 <= transport '0';       -- kept: transport
    wait for 0 ns;
    s5 <= '0';                 -- left out, at 1ns +1
    wait for 3 ns;
    s2 <= '1' after 2 ns;      -- a pending transaction ...
    s2 <= '0';                 -- ... so this one is kept, and it cancels the pending '1'
    wait;
  end process;
end architecture;
