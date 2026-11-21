-- NEXUS-4 processor: shared types and constants.
-- MIT License, Copyright (c) 2026 Grigorios Agathangelidis.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

package nexus4_pkg is
  subtype word_t is std_logic_vector(31 downto 0);
  type word_array is array (natural range <>) of word_t;

  -- the memory map (D47): two scratchpads, instructions and data (Harvard, D12)
  constant IMEM_BASE : unsigned(31 downto 0) := x"00000000";
  constant DMEM_BASE : unsigned(31 downto 0) := x"00010000";

  -- trap causes, numbered as in mcause (D48)
  constant CAUSE_FETCH_MISALIGNED : natural := 0;
  constant CAUSE_FETCH_FAULT      : natural := 1;
  constant CAUSE_ILLEGAL          : natural := 2;
  constant CAUSE_BREAKPOINT       : natural := 3;
  constant CAUSE_LOAD_MISALIGNED  : natural := 4;
  constant CAUSE_LOAD_FAULT       : natural := 5;
  constant CAUSE_STORE_MISALIGNED : natural := 6;
  constant CAUSE_STORE_FAULT      : natural := 7;
  constant CAUSE_ECALL            : natural := 11;

  -- what a committed instruction did to memory
  constant MEM_NONE  : std_logic_vector(1 downto 0) := "00";
  constant MEM_LOAD  : std_logic_vector(1 downto 0) := "01";
  constant MEM_STORE : std_logic_vector(1 downto 0) := "10";

  -- a memory image of `words` words: src first, then zeros (for the initial contents of a scratchpad)
  function memory_image(src : word_array; words : positive) return word_array;
end package;

package body nexus4_pkg is
  function memory_image(src : word_array; words : positive) return word_array is
    variable r : word_array(0 to words - 1) := (others => (others => '0'));
  begin
    for i in 0 to src'length - 1 loop
      if i < words then
        r(i) := src(src'low + i);
      end if;
    end loop;
    return r;
  end function;
end package body;
