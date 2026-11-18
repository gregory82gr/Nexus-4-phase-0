-- @top: register_file
-- @stop: 120ns
-- @kernel: required
-- @purpose: A small register file: an array of vectors, written on the clock at a dynamic address, read without the clock.
-- @purpose: Register 0 always reads as zero, as in RISC-V.
-- @expect: .register_file(rtl).regs(2)(7) = '1' @ 15ns +1
-- @expect: .register_file(rtl).rdata(0) = '1' @ 25ns +2
-- @expect-report: x0 reads 00 after a write
-- @expect-report: x3 = A5
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity register_file is
end entity;

architecture rtl of register_file is
  type regs_t is array (0 to 3) of std_logic_vector(7 downto 0);
  signal clk   : std_logic := '0';
  signal we    : std_logic := '0';
  signal waddr : unsigned(1 downto 0) := "00";
  signal raddr : unsigned(1 downto 0) := "00";
  signal wdata : std_logic_vector(7 downto 0) := (others => '0');
  signal rdata : std_logic_vector(7 downto 0);
  signal regs  : regs_t := (others => (others => '0'));
begin
  clk <= not clk after 5 ns;

  write_port : process (clk)
  begin
    if rising_edge(clk) then
      if we = '1' and waddr /= 0 then
        regs(to_integer(waddr)) <= wdata;
      end if;
    end if;
  end process;

  rdata <= regs(to_integer(raddr));

  stim : process
  begin
    we <= '1'; waddr <= "10"; wdata <= x"81";
    wait until rising_edge(clk);
    waddr <= "11"; wdata <= x"A5";
    wait until rising_edge(clk);
    waddr <= "00"; wdata <= x"FF";
    wait until rising_edge(clk);
    we <= '0';
    raddr <= "11";
    wait for 1 ns;
    report "x3 = " & to_hstring(rdata);
    raddr <= "00";
    wait for 1 ns;
    report "x0 reads " & to_hstring(rdata) & " after a write";
    wait;
  end process;
end architecture;
