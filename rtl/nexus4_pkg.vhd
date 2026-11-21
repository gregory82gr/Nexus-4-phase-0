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
  constant IO_STATUS : natural := 6;              -- read: the profile; ORBIT: the last restart's cause (bits 15-8)
                                                  -- and the number of restarts (bits 23-16)
  constant IO_CORR   : natural := 7;              -- read (ORBIT): the number of single-bit errors corrected
  constant WDT_KEY   : word_t := x"5AFEC0DE";     -- a runaway store is very unlikely to write it

  -- the profiles (D16): one design, chosen by PROGRAM_PROFILE
  constant PROFILE_BASE  : natural := 0;
  constant PROFILE_PLANT : natural := 1;
  constant PROFILE_ORBIT : natural := 2;

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
  -- ORBIT (D56): a Hsiao (39,32) SEC-DED code. Seven check bits; each data bit is covered by three of
  -- them (a column of weight 3, no two alike), each check bit by one. Row r covers the data bits set in
  -- ECC_MASK(r) (13 or 14 bits per row, as balanced as 32 columns of weight 3 allow).
  subtype chk_t is std_logic_vector(6 downto 0);
  type chk_array is array (natural range <>) of chk_t;
  type ecc_masks_t is array (0 to 6) of word_t;
  constant ECC_MASK : ecc_masks_t := (x"00001FFF", x"007FE007", x"1F81E078", x"638E2389", x"ACB24C92", x"D5549524", x"FA691A40");
  constant RESTART_ERROR    : natural := 1;       -- the cause of a restart: an uncorrectable error
  constant RESTART_WATCHDOG : natural := 2;       -- or the watchdog
  constant RESTART_TRAP     : natural := 3;     -- ORBIT: a trap other than ecall (the program went wrong)
  function ecc_check(w : word_t) return chk_t;                     -- the check bits of a word
  function ecc_state(w : word_t; c : chk_t) return natural;        -- 0 good, 1 one bit wrong, 2 uncorrectable
  function ecc_fix(w : word_t; c : chk_t) return word_t;           -- the word, with a single data bit corrected
  function chk_image(src : word_array; words : positive) return chk_array;

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

  function ecc_check(w : word_t) return chk_t is
    variable c : chk_t;
  begin
    for r in 0 to 6 loop
      c(r) := xor (w and ECC_MASK(r));
    end loop;
    return c;
  end function;

  -- the column of data bit i: the rows whose mask has bit i
  function ecc_column(i : natural) return chk_t is
    variable c : chk_t;
  begin
    for r in 0 to 6 loop
      c(r) := ECC_MASK(r)(i);
    end loop;
    return c;
  end function;

  function ecc_state(w : word_t; c : chk_t) return natural is
    variable s : chk_t;
    variable ones : natural := 0;
  begin
    s := c xor ecc_check(w);
    if s = "0000000" then
      return 0;
    end if;
    for r in 0 to 6 loop
      if s(r) = '1' then ones := ones + 1; end if;
    end loop;
    if ones = 1 then
      return 1;                                     -- a check bit itself
    end if;
    for i in 0 to 31 loop
      if s = ecc_column(i) then
        return 1;                                   -- data bit i
      end if;
    end loop;
    return 2;                                       -- an even syndrome (two bits), or no column: uncorrectable
  end function;

  function ecc_fix(w : word_t; c : chk_t) return word_t is
    variable s : chk_t;
    variable r : word_t;
  begin
    s := c xor ecc_check(w);
    r := w;
    for i in 0 to 31 loop
      if s = ecc_column(i) then
        r(i) := not w(i);
      end if;
    end loop;
    return r;
  end function;

  function chk_image(src : word_array; words : positive) return chk_array is
    variable img : word_array(0 to words - 1);
    variable r : chk_array(0 to words - 1);
  begin
    img := memory_image(src, words);
    for i in 0 to words - 1 loop
      r(i) := ecc_check(img(i));
    end loop;
    return r;
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
