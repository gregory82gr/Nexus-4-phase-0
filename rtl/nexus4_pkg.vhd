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
  -- the I/O page (D52, D55): eight word registers, reached only by lw and sw
  constant IO_BASE   : unsigned(31 downto 0) := x"00020000";
  constant IO_END    : unsigned(31 downto 0) := x"00020020";
  constant IO_SENSOR : natural := 0;              -- words 0-3: the sensor inputs (read)
  constant IO_TRIP   : natural := 4;              -- write bit 0: trip; read: the trip causes below
  constant IO_WDT    : natural := 5;              -- write WDT_KEY: restart the watchdog
  constant IO_STATUS : natural := 6;              -- read: the profile
  constant WDT_KEY   : word_t := x"5AFEC0DE";     -- a runaway store is very unlikely to write it

  -- the profiles (D16): one design, chosen by PROGRAM_PROFILE
  constant PROFILE_BASE  : natural := 0;
  constant PROFILE_PLANT : natural := 1;

  -- the trip causes, as bits of the trip output and of the TRIP register
  constant TRIP_PROGRAM  : natural := 0;          -- the program wrote 1 to TRIP
  constant TRIP_LOCKSTEP : natural := 1;          -- PLANT: the two cores disagreed
  constant TRIP_PARITY   : natural := 2;          -- PLANT: a scratchpad word failed its parity check
  constant TRIP_WATCHDOG : natural := 3;          -- the watchdog was not restarted in time

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
  -- even parity of a word (1 when it has an odd number of ones), and of every word of an image
  function parity(w : word_t) return std_logic;
  function parity_image(src : word_array; words : positive) return std_logic_vector;
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

  function parity(w : word_t) return std_logic is
  begin
    return xor w;
  end function;

  function parity_image(src : word_array; words : positive) return std_logic_vector is
    variable img : word_array(0 to words - 1);
    variable r : std_logic_vector(0 to words - 1);
  begin
    img := memory_image(src, words);
    for i in 0 to words - 1 loop
      r(i) := parity(img(i));
    end loop;
    return r;
  end function;
end package body;
