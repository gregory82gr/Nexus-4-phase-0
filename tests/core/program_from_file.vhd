-- GHDL only (tools/core-check.mjs): the package nexus4_program, read from files at elaboration, so that
-- the design is analysed and elaborated once and every program runs on the same executable.
-- The NEXUS-4 kernel and the page use the package written out as constants instead; the design is the same.
--   program_text.hex, program_data.hex: one 8-digit hex word per line
--   program_sizes.txt:                  two lines, the words of the instruction and of the data scratchpad
-- MIT License, Copyright (c) 2026 Grigorios Agathangelidis.
library ieee;
use ieee.std_logic_1164.all;
use std.textio.all;
use work.nexus4_pkg.all;

package nexus4_program is
  impure function count_lines(name : string) return natural;
  impure function read_words(name : string; n : natural) return word_array;
  impure function read_size(index : natural) return positive;
  constant PROGRAM_TEXT : word_array;
  constant PROGRAM_DATA : word_array;
  constant PROGRAM_IMEM_WORDS : positive;
  constant PROGRAM_DMEM_WORDS : positive;
end package;

package body nexus4_program is
  impure function count_lines(name : string) return natural is
    file f : text open read_mode is name;
    variable l : line;
    variable n : natural := 0;
  begin
    while not endfile(f) loop
      readline(f, l);
      n := n + 1;
    end loop;
    return n;
  end function;

  impure function read_words(name : string; n : natural) return word_array is
    file f : text open read_mode is name;
    variable l : line;
    variable r : word_array(0 to n - 1);
  begin
    for i in 0 to n - 1 loop
      readline(f, l);
      hread(l, r(i));
    end loop;
    return r;
  end function;

  impure function read_size(index : natural) return positive is
    file f : text open read_mode is "program_sizes.txt";
    variable l : line;
    variable v : positive;
  begin
    for i in 0 to index loop
      readline(f, l);
    end loop;
    read(l, v);
    return v;
  end function;

  constant PROGRAM_TEXT : word_array := read_words("program_text.hex", count_lines("program_text.hex"));
  constant PROGRAM_DATA : word_array := read_words("program_data.hex", count_lines("program_data.hex"));
  constant PROGRAM_IMEM_WORDS : positive := read_size(0);
  constant PROGRAM_DMEM_WORDS : positive := read_size(1);
end package body;
