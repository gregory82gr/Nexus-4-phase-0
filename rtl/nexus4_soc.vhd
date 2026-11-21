-- NEXUS-4 processor: the core with its two scratchpads and the I/O page, loaded with a program,
-- in one of the profiles of D16.
-- MIT License, Copyright (c) 2026 Grigorios Agathangelidis.
--
-- The program comes from the package nexus4_program, which the tools write from an assembled
-- program (tools/core-check.mjs, the Processor page): PROGRAM_TEXT, PROGRAM_DATA and the sizes
-- of the scratchpads; PROGRAM_PROFILE, PROGRAM_WDT_CYCLES and PROGRAM_SENSORS. The hardware has
-- 64 KiB of each scratchpad (D47); a simulation uses the smallest power of two that holds the
-- program, and the reference model is given the same sizes.
--
-- PLANT (D52, D55): a second core, the shadow, runs the same program two cycles behind the first
-- (delayed lockstep, as in TI's CCM-R5 and Infineon's AURIX), fed with the first core's inputs two
-- cycles late. Every output of the first core, two cycles late, is compared with the shadow's: the
-- memory and I/O addresses, the data written, the byte lanes, the commit port. A difference trips.
-- The scratchpads are outside the two cores, so lockstep cannot see an upset in them: each word has
-- a parity bit, checked whenever a word is used, and a failed check trips too; so does the I/O page's
-- read register. The choice between RAM and the I/O page for a load is made twice, once for each core,
-- so that an upset in one choice shows as a difference between them. A trip from the
-- hardware stops both cores (the fail-safe state); the trip output stays set until reset. A core that
-- stops on a trap other than ecall no longer restarts the watchdog, which then trips; until it does,
-- the PLANT system does not report itself halted (the clock keeps running).
-- Lockstep catches random hardware faults, not design errors: both cores would make the same one.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;
use work.nexus4_program.all;

entity nexus4_soc is
  port (
    clk, rst     : in  std_logic;
    commit       : out std_logic;
    commit_pc    : out word_t;
    commit_insn  : out word_t;
    commit_rd    : out natural range 0 to 31;
    commit_wdata : out word_t;
    commit_mem   : out std_logic_vector(1 downto 0);
    commit_maddr : out word_t;
    commit_mdata : out word_t;
    commit_trap  : out std_logic;
    commit_cause : out natural range 0 to 15;
    commit_tval  : out word_t;
    halted       : out std_logic;
    trip         : out std_logic_vector(3 downto 0));
end entity;

architecture rtl of nexus4_soc is
  signal imem_addr, dmem_addr : unsigned(31 downto 0);
  signal imem_rdata, dmem_rdata, dmem_wdata : word_t;
  signal ram_rdata, io_rdata : word_t;
  signal dmem_be : std_logic_vector(3 downto 0);
  signal dmem_we, dmem_re, io_we : std_logic;
  signal imem_rpar, dmem_rpar, dmem_perr, io_rpar : std_logic;
  signal read_io, read_ram : std_logic := '0';     -- what the last edge read: the I/O page, or a load from RAM
  signal causes, hw_trip : std_logic_vector(3 downto 0);
  signal stop : std_logic;
  signal m_halted : std_logic;
  -- the commit port of the first core, kept here so that PLANT can compare it
  signal c_commit, c_trap : std_logic;
  signal c_pc, c_insn, c_wdata, c_maddr, c_mdata, c_tval : word_t;
  signal c_rd : natural range 0 to 31;
  signal c_mem : std_logic_vector(1 downto 0);
  signal c_cause : natural range 0 to 15;
  -- PLANT
  signal lockstep_err : std_logic := '0';
  signal parity_err : std_logic := '0';
  signal s_halted : std_logic := '0';
  signal ended : std_logic := '0';               -- the first core committed ecall: the program's normal end
begin
  core : entity work.nexus4_core
    generic map (IMEM_WORDS => PROGRAM_IMEM_WORDS, DMEM_WORDS => PROGRAM_DMEM_WORDS)
    port map (
      clk => clk, rst => rst, stop => stop,
      imem_addr => imem_addr, imem_rdata => imem_rdata,
      dmem_addr => dmem_addr, dmem_wdata => dmem_wdata, dmem_be => dmem_be, dmem_we => dmem_we, dmem_re => dmem_re,
      dmem_rdata => dmem_rdata,
      commit => c_commit, commit_pc => c_pc, commit_insn => c_insn, commit_rd => c_rd,
      commit_wdata => c_wdata, commit_mem => c_mem, commit_maddr => c_maddr, commit_mdata => c_mdata,
      commit_trap => c_trap, commit_cause => c_cause, commit_tval => c_tval, halted => m_halted);

  commit <= c_commit; commit_pc <= c_pc; commit_insn <= c_insn; commit_rd <= c_rd; commit_wdata <= c_wdata;
  commit_mem <= c_mem; commit_maddr <= c_maddr; commit_mdata <= c_mdata; commit_trap <= c_trap;
  commit_cause <= c_cause; commit_tval <= c_tval;

  imem : entity work.nexus4_imem
    generic map (WORDS => PROGRAM_IMEM_WORDS, IMAGE => PROGRAM_TEXT)
    port map (clk => clk, addr => imem_addr, rdata => imem_rdata, rpar => imem_rpar);

  dmem : entity work.nexus4_dmem
    generic map (WORDS => PROGRAM_DMEM_WORDS, IMAGE => PROGRAM_DATA)
    port map (clk => clk, addr => dmem_addr, wdata => dmem_wdata, be => dmem_be, we => dmem_we,
              rdata => ram_rdata, rpar => dmem_rpar, perr => dmem_perr);

  io_we <= dmem_we when dmem_addr >= IO_BASE and dmem_addr < IO_END else '0';
  io : entity work.nexus4_io
    generic map (PROFILE => PROGRAM_PROFILE, WDT_CYCLES => PROGRAM_WDT_CYCLES, SENSORS => PROGRAM_SENSORS)
    port map (clk => clk, rst => rst, addr => dmem_addr, wdata => dmem_wdata, we => io_we, hw_trip => hw_trip,
              rdata => io_rdata, rpar => io_rpar, trip => causes);

  -- the data a load gets: from the I/O page or from RAM, by the address the last edge read
  process (clk)
  begin
    if rising_edge(clk) then
      if dmem_addr >= IO_BASE and dmem_addr < IO_END then read_io <= '1'; else read_io <= '0'; end if;
      read_ram <= dmem_re;
      if c_commit = '1' and c_trap = '1' and c_cause = CAUSE_ECALL then ended <= '1'; end if;
    end if;
  end process;
  dmem_rdata <= io_rdata when read_io = '1' else ram_rdata;

  hw_trip <= '0' & parity_err & lockstep_err & '0';
  trip <= causes;
  -- a trip from the hardware stops the cores; one the program asks for does not
  stop <= causes(TRIP_LOCKSTEP) or causes(TRIP_PARITY) or causes(TRIP_WATCHDOG);
  halted <= s_halted and (ended or stop) when PROGRAM_PROFILE = PROFILE_PLANT else m_halted;

  plant : if PROGRAM_PROFILE = PROFILE_PLANT generate
    constant W : natural := 32 * 9 + 4 + 3 + 5 + 2 + 1 + 4 + 1;
    signal i_d1, i_d2, rr_d1, rr_d2, ior_d1, ior_d2, r_d2 : word_t := (others => '0');
    signal s_read_io : std_logic := '0';
    signal rst_d1, rst_d2 : std_logic := '1';
    signal m_out, s_out, m_d1, m_d2 : std_logic_vector(W - 1 downto 0) := (others => '0');
    signal s_imem_addr, s_dmem_addr : unsigned(31 downto 0);
    signal s_dmem_wdata : word_t;
    signal s_dmem_be : std_logic_vector(3 downto 0);
    signal s_dmem_we, s_dmem_re : std_logic;
    signal s_commit, s_trap : std_logic;
    signal s_pc, s_insn, s_wdata, s_maddr, s_mdata, s_tval : word_t;
    signal s_rd : natural range 0 to 31;
    signal s_mem : std_logic_vector(1 downto 0);
    signal s_cause : natural range 0 to 15;
    signal m_rd5, s_rd5 : std_logic_vector(4 downto 0);
    signal m_cause4, s_cause4 : std_logic_vector(3 downto 0);
  begin
    shadow : entity work.nexus4_core
      generic map (IMEM_WORDS => PROGRAM_IMEM_WORDS, DMEM_WORDS => PROGRAM_DMEM_WORDS)
      port map (
        clk => clk, rst => rst_d2, stop => stop,
        imem_addr => s_imem_addr, imem_rdata => i_d2,
        dmem_addr => s_dmem_addr, dmem_wdata => s_dmem_wdata, dmem_be => s_dmem_be, dmem_we => s_dmem_we, dmem_re => s_dmem_re,
        dmem_rdata => r_d2,   -- its own choice between RAM and I/O, below
        commit => s_commit, commit_pc => s_pc, commit_insn => s_insn, commit_rd => s_rd,
        commit_wdata => s_wdata, commit_mem => s_mem, commit_maddr => s_maddr, commit_mdata => s_mdata,
        commit_trap => s_trap, commit_cause => s_cause, commit_tval => s_tval, halted => s_halted);

    r_d2 <= ior_d2 when s_read_io = '1' else rr_d2;
    m_rd5 <= std_logic_vector(to_unsigned(c_rd, 5));
    s_rd5 <= std_logic_vector(to_unsigned(s_rd, 5));
    m_cause4 <= std_logic_vector(to_unsigned(c_cause, 4));
    s_cause4 <= std_logic_vector(to_unsigned(s_cause, 4));
    -- everything a core does to the outside, as one vector
    m_out <= std_logic_vector(imem_addr) & std_logic_vector(dmem_addr) & dmem_wdata & dmem_be & dmem_we & dmem_re & c_commit &
             c_pc & c_insn & m_rd5 & c_wdata & c_mem & c_maddr & c_mdata & c_trap & m_cause4 & c_tval & m_halted;
    s_out <= std_logic_vector(s_imem_addr) & std_logic_vector(s_dmem_addr) & s_dmem_wdata & s_dmem_be & s_dmem_we & s_dmem_re & s_commit &
             s_pc & s_insn & s_rd5 & s_wdata & s_mem & s_maddr & s_mdata & s_trap & s_cause4 & s_tval & s_halted;

    lockstep : process (clk)
    begin
      if rising_edge(clk) then
        -- the shadow's inputs: the first core's, two cycles late
        i_d1 <= imem_rdata; i_d2 <= i_d1;
        rr_d1 <= ram_rdata; rr_d2 <= rr_d1;
        ior_d1 <= io_rdata; ior_d2 <= ior_d1;
        if s_dmem_addr >= IO_BASE and s_dmem_addr < IO_END then s_read_io <= '1'; else s_read_io <= '0'; end if;
        rst_d1 <= rst; rst_d2 <= rst_d1;
        -- the first core's outputs, two cycles late, against the shadow's now
        m_d1 <= m_out; m_d2 <= m_d1;
        if rst_d2 = '0' and stop = '0' and m_d2 /= s_out then lockstep_err <= '1'; end if;
        -- parity: the instruction word in every cycle (it is the one at pc), a loaded word when it arrives
        if rst = '0' and stop = '0' then
          if parity(imem_rdata) /= imem_rpar then parity_err <= '1'; end if;
          if read_ram = '1' and read_io = '0' and parity(ram_rdata) /= dmem_rpar then parity_err <= '1'; end if;
          if read_ram = '1' and read_io = '1' and parity(io_rdata) /= io_rpar then parity_err <= '1'; end if;
          if dmem_perr = '1' then parity_err <= '1'; end if;
        end if;
      end if;
    end process;
  end generate;
end architecture;
