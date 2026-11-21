-- Single-event upsets deposited by the NEXUS-4 kernel (kernel 0.4, D52), checked against GHDL.
-- MIT License, Copyright (c) 2026 Grigorios Agathangelidis.
--
-- VHDL has no statement that changes the value a driver holds: force/release changes the effective
-- value and gives it back at release, so a register that holds its value would forget the upset. The
-- kernel deposits into the driver instead (a simulator command, like force -deposit in other tools).
-- To check it against GHDL, the same design has saboteurs, compiled in only with SAB = true: each one
-- makes the process that owns the state element write the upset value at the fault's time. GHDL runs
-- the design with -gSAB=true; the kernel runs it with SAB = false and the faults below. A saboteur's
-- write lands one delta cycle after the kernel's deposit, so tools/fault-check.mjs compares the
-- signals at the end of every time step (after the last delta), not delta by delta.
-- @top: seu_basics
-- @stop: 95ns
-- @fault: flip .seu_basics(rtl).r(2) at 22ns
-- @fault: flip .seu_basics(rtl).regs(2)(1) at 27ns
-- @fault: flip .seu_basics(rtl).rom(0) at 33ns
-- @fault: set .seu_basics(rtl).state at 41ns to s_c
-- @fault: flip .seu_basics(rtl).count at 52ns bit 2
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity seu_basics is
  generic (SAB : boolean := false);
end entity;

architecture rtl of seu_basics is
  type state_t is (s_a, s_b, s_c);
  type regs_t is array (0 to 3) of std_logic_vector(3 downto 0);
  signal clk   : std_logic := '0';
  signal en    : std_logic := '0';
  signal r     : std_logic_vector(3 downto 0) := "0011";   -- held until en, then shifts
  signal regs  : regs_t := (others => "0000");              -- a small register file
  signal rom   : std_logic_vector(3 downto 0) := "1001";   -- nobody drives it (unless SAB)
  signal state : state_t := s_a;
  signal count : natural range 0 to 15 := 0;
  signal q     : std_logic_vector(3 downto 0);
  signal rd2   : std_logic_vector(3 downto 0);
  signal inj   : std_logic_vector(4 downto 0) := "00000"; -- saboteur strobes (SAB only)
begin
  clk <= not clk after 5 ns;
  en  <= '1' after 60 ns;

  shift : process (clk, inj)
  begin
    if rising_edge(clk) then
      if en = '1' then r <= r(2 downto 0) & '1'; end if;
    end if;
    if SAB and inj(0)'event and inj(0) = '1' then r(2) <= not r(2); end if;
  end process;

  regfile : process (clk, inj)
  begin
    if rising_edge(clk) then
      if state = s_b then regs(1) <= r; end if;            -- regs(2) is never written: the upset stays
    end if;
    if SAB and inj(1)'event and inj(1) = '1' then regs(2)(1) <= not regs(2)(1); end if;
  end process;

  fsm : process (clk, inj)
  begin
    if rising_edge(clk) then
      case state is
        when s_a => if count = 3 then state <= s_b; end if;
        when s_b => state <= s_a;
        when s_c => null;                                   -- a stuck state: only the upset gets here
      end case;
      if count = 15 then count <= 0; else count <= count + 1; end if;
    end if;
    if SAB and inj(3)'event and inj(3) = '1' then state <= s_c; end if;
    if SAB and inj(4)'event and inj(4) = '1' then
      count <= to_integer(to_unsigned(count, 4) xor "0100");
    end if;
  end process;

  q   <= r xor rom;
  rd2 <= regs(2);

  saboteurs : if SAB generate
    inj(0) <= '1' after 22 ns;
    inj(1) <= '1' after 27 ns;
    inj(3) <= '1' after 41 ns;
    inj(4) <= '1' after 52 ns;
    romflip : process begin wait for 33 ns; rom(0) <= not rom(0); wait; end process;
  end generate;
end architecture;
