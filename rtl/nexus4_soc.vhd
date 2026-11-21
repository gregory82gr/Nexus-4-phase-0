-- NEXUS-4 processor: the core with its two scratchpads, loaded with a program.
-- MIT License, Copyright (c) 2026 Grigorios Agathangelidis.
--
-- The program comes from the package nexus4_program, which the tools write from an assembled
-- program (tools/core-check.mjs, the Processor page): PROGRAM_TEXT, PROGRAM_DATA and the sizes
-- of the scratchpads. The hardware has 64 KiB of each (D47); a simulation uses the smallest
-- power of two that holds the program, and the reference model is given the same sizes.
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
    halted       : out std_logic);
end entity;

architecture rtl of nexus4_soc is
  signal imem_addr, dmem_addr : unsigned(31 downto 0);
  signal imem_rdata, dmem_rdata, dmem_wdata : word_t;
  signal dmem_be : std_logic_vector(3 downto 0);
  signal dmem_we : std_logic;
begin
  core : entity work.nexus4_core
    generic map (IMEM_WORDS => PROGRAM_IMEM_WORDS, DMEM_WORDS => PROGRAM_DMEM_WORDS)
    port map (
      clk => clk, rst => rst,
      imem_addr => imem_addr, imem_rdata => imem_rdata,
      dmem_addr => dmem_addr, dmem_wdata => dmem_wdata, dmem_be => dmem_be, dmem_we => dmem_we, dmem_rdata => dmem_rdata,
      commit => commit, commit_pc => commit_pc, commit_insn => commit_insn, commit_rd => commit_rd,
      commit_wdata => commit_wdata, commit_mem => commit_mem, commit_maddr => commit_maddr, commit_mdata => commit_mdata,
      commit_trap => commit_trap, commit_cause => commit_cause, commit_tval => commit_tval, halted => halted);

  imem : entity work.nexus4_imem
    generic map (WORDS => PROGRAM_IMEM_WORDS, IMAGE => PROGRAM_TEXT)
    port map (clk => clk, addr => imem_addr, rdata => imem_rdata);

  dmem : entity work.nexus4_dmem
    generic map (WORDS => PROGRAM_DMEM_WORDS, IMAGE => PROGRAM_DATA)
    port map (clk => clk, addr => dmem_addr, wdata => dmem_wdata, be => dmem_be, we => dmem_we, rdata => dmem_rdata);
end architecture;
