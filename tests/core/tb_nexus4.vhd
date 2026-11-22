-- Testbench for the NEXUS-4 processor: runs the program in nexus4_program and reports every
-- commit, one line each, for tools/core-check.mjs to compare with the reference model:
--   C pc insn rd wdata mem maddr mdata      an instruction that completed (mem: N, L or S)
--   T pc insn cause tval                     a trap: the core stops
-- and TRIP, RESTART, GUARD, HALT and CORRECTED lines for what the profiles and the guardian do
-- MIT License, Copyright (c) 2026 Grigorios Agathangelidis.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

entity tb_nexus4 is
end entity;

architecture sim of tb_nexus4 is
  signal clk          : std_logic := '0';
  signal rst          : std_logic := '1';
  signal commit       : std_logic;
  signal commit_pc    : word_t;
  signal commit_insn  : word_t;
  signal commit_rd    : natural range 0 to 31;
  signal commit_wdata : word_t;
  signal commit_mem   : std_logic_vector(1 downto 0);
  signal commit_maddr : word_t;
  signal commit_mdata : word_t;
  signal commit_trap  : std_logic;
  signal commit_cause : natural range 0 to 15;
  signal commit_tval  : word_t;
  signal halted       : std_logic;
  signal trip         : trip_t;
  signal guard_code   : natural range 0 to 31;
  signal restart      : std_logic;
  signal restart_cause : natural range 0 to 4;
  signal corrections  : natural;
  signal cycles       : natural := 0;
begin
  clk <= not clk after 5 ns when halted /= '1';
  rst <= '0' after 10 ns;

  soc : entity work.nexus4_soc
    port map (clk => clk, rst => rst, commit => commit, commit_pc => commit_pc, commit_insn => commit_insn,
              commit_rd => commit_rd, commit_wdata => commit_wdata, commit_mem => commit_mem,
              commit_maddr => commit_maddr, commit_mdata => commit_mdata, commit_trap => commit_trap,
              commit_cause => commit_cause, commit_tval => commit_tval, halted => halted, trip => trip,
              restart => restart, restart_cause => restart_cause, corrections => corrections, guard_code => guard_code);

  -- ORBIT (D56): each restart, with its cause (1 an uncorrectable error, 2 the watchdog), and at the end
  -- the number of single-bit errors corrected
  restarts : process (clk)
  begin
    if rising_edge(clk) and restart = '1' then
      report "RESTART " & integer'image(restart_cause) & " after " & integer'image(cycles) & " cycles";
    end if;
  end process;

  -- the trip output (D55): reported each time it changes, with its causes as one hex digit
  -- (1 the program, 2 lockstep, 4 parity, 8 the watchdog, 10 the guardian; 0 if a trip were ever lost)
  trips : process (trip)
  begin
    if now > 0 ns and trip /= "UUUUU" then
      report "TRIP " & to_hstring(trip) & " after " & integer'image(cycles) & " cycles";
    end if;
  end process;

  -- the guardian (D59): its first violation, with its code (1–8 an invariant, 9–10 an automaton, 11–14 a
  -- deadline, 15 a byte store to a mapped variable, 16 a transition not enabled, 17–24 a place over its
  -- capacity, 25 a dead marking for too long, D62)
  guardian : process (guard_code)
  begin
    if guard_code /= 0 then
      report "GUARD " & integer'image(guard_code) & " after " & integer'image(cycles) & " cycles";
    end if;
  end process;

  monitor : process (clk)
  begin
    if rising_edge(clk) then
      if rst = '0' then
        cycles <= cycles + 1;
      end if;
      if commit = '1' then
        if commit_trap = '1' then
          report "T " & to_hstring(commit_pc) & " " & to_hstring(commit_insn) & " " &
                 integer'image(commit_cause) & " " & to_hstring(commit_tval);
        elsif commit_mem = MEM_LOAD then
          report "C " & to_hstring(commit_pc) & " " & to_hstring(commit_insn) & " " & integer'image(commit_rd) & " " &
                 to_hstring(commit_wdata) & " L " & to_hstring(commit_maddr) & " 00000000";
        elsif commit_mem = MEM_STORE then
          report "C " & to_hstring(commit_pc) & " " & to_hstring(commit_insn) & " " & integer'image(commit_rd) & " " &
                 to_hstring(commit_wdata) & " S " & to_hstring(commit_maddr) & " " & to_hstring(commit_mdata);
        else
          report "C " & to_hstring(commit_pc) & " " & to_hstring(commit_insn) & " " & integer'image(commit_rd) & " " &
                 to_hstring(commit_wdata) & " N 00000000 00000000";
        end if;
      end if;
    end if;
  end process;

  done : process
  begin
    wait until halted = '1';
    report "HALT after " & integer'image(cycles) & " cycles";
    if corrections > 0 then                         -- ORBIT: single-bit errors corrected on the way
      report "CORRECTED " & integer'image(corrections);
    end if;
    wait;
  end process;
end architecture;
