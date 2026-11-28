-- @top: process_without_wait
-- @kernel-refuses: error: a process without a sensitivity list must contain a wait statement
-- @ghdl: warns: infinite loop for this process without a wait statement
-- @purpose: Legal VHDL that can only loop for ever at time 0: GHDL warns and runs it (here until k overflows). The
-- @purpose: kernel refuses it, deliberately stricter than GHDL (decision D73), as the assembler is in stricter.txt.
entity process_without_wait is
end entity;

architecture sim of process_without_wait is
begin
  spin : process
    variable k : integer := 0;
  begin
    k := k + 1;
  end process;
end architecture;
