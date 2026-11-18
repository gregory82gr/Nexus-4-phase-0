-- @top: ram_read_timing
-- @stop: 60ns
-- @kernel: required
-- @purpose: A small RAM, read two ways. The asynchronous read follows the address at once; the synchronous read
-- @purpose: delivers its data one clock later. Reading the address being written returns the old data.
-- @expect: .ram_read_timing(rtl).q_async(0) = '1' @ 15ns +2
-- @expect: .ram_read_timing(rtl).q_sync(0) = '0' @ 15ns +1
-- @expect: .ram_read_timing(rtl).q_sync(0) = '1' @ 25ns +1
-- @expect-report: read during write at 15 ns returned 00, then 55
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity ram_read_timing is
end entity;

architecture rtl of ram_read_timing is
  type mem_t is array (0 to 7) of std_logic_vector(7 downto 0);
  signal mem : mem_t := (others => (others => '0'));
  signal clk : std_logic := '0';
  signal we : std_logic := '0';
  signal addr : unsigned(2 downto 0) := "000";
  signal wdata : std_logic_vector(7 downto 0) := x"00";
  signal q_async, q_sync : std_logic_vector(7 downto 0);
begin
  clk <= not clk after 5 ns;

  ram : process (clk)
  begin
    if rising_edge(clk) then
      if we = '1' then
        mem(to_integer(addr)) <= wdata;
      end if;
      q_sync <= mem(to_integer(addr));   -- reads mem as it was before this edge
    end if;
  end process;

  q_async <= mem(to_integer(addr));      -- no clock: follows mem and addr

  stim : process
  begin
    wait for 12 ns;
    addr <= "011"; wdata <= x"55"; we <= '1';   -- write 55 to address 3 at the edge at 15 ns
    wait until rising_edge(clk);
    we <= '0';
    wait for 1 ns;
    report "read during write at 15 ns returned " & to_hstring(q_sync) & ", then " & to_hstring(q_async);
    wait;
  end process;
end architecture;
