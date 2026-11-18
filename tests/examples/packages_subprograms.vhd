-- @top: packages_subprograms
-- @stop: 60ns
-- @kernel: required
-- @purpose: A package of functions (overloaded, a default parameter, a local variable whose bounds come from the
-- @purpose: argument), a testbench procedure with signal parameters that waits, a variable out parameter,
-- @purpose: a selected signal assignment and aliases. Software engineers meet "subroutines that take time" here.
-- @expect: .packages_subprograms(sim).parity_out = '1' @ 10ns +2
-- @expect: .packages_subprograms(sim).count = 3 @ 10ns +0
-- @expect-event: .packages_subprograms(sim).clk @ 15ns +0
-- @expect: .packages_subprograms(sim).mode_name = 2 @ 35ns +2
-- @expect: .packages_subprograms(sim).mode_name = 7 @ 45ns +2
-- @expect-report: frames sent: 3
library ieee;
use ieee.std_logic_1164.all;

package frame_util is
  function parity(v : std_logic_vector) return std_logic;
  function ones(v : std_logic_vector) return natural;
  function ones(b : boolean) return natural;
  function clamp(x : integer; hi : integer := 7) return integer;
  function reversed(v : std_logic_vector) return std_logic_vector;
end package;

package body frame_util is
  function parity(v : std_logic_vector) return std_logic is
    variable p : std_logic := '0';
  begin
    for i in v'range loop
      p := p xor v(i);
    end loop;
    return p;
  end function;

  function ones(v : std_logic_vector) return natural is
    variable n : natural := 0;
  begin
    for i in v'range loop
      if v(i) = '1' then n := n + 1; end if;
    end loop;
    return n;
  end function;

  function ones(b : boolean) return natural is
  begin
    if b then return 1; else return 0; end if;
  end function;

  function clamp(x : integer; hi : integer := 7) return integer is
  begin
    if x > hi then return hi; end if;
    return x;
  end function;

  function reversed(v : std_logic_vector) return std_logic_vector is
    variable r : std_logic_vector(v'range);
  begin
    for i in v'range loop
      r(i) := v(v'left + v'right - i);
    end loop;
    return r;
  end function;
end package body;

library ieee;
use ieee.std_logic_1164.all;
use work.frame_util.all;

entity packages_subprograms is
end entity;

architecture sim of packages_subprograms is
  signal clk : std_logic := '0';
  signal data : std_logic_vector(7 downto 0) := x"00";
  signal parity_out : std_logic;
  signal count : integer := 0;
  signal mode : std_logic_vector(1 downto 0) := "00";
  signal mode_name : integer := 0;
  signal flipped : std_logic_vector(7 downto 0);
  alias low_nibble : std_logic_vector(3 downto 0) is data(3 downto 0);
  alias top : std_logic is data(7);
begin
  clk <= not clk after 5 ns when now < 50 ns;
  parity_out <= parity(data);
  flipped <= reversed(data);

  with mode select
    mode_name <= 1 when "01",
                 2 when "10",
                 clamp(100) when "11",
                 0 when others;

  stim : process
    procedure send(constant v : in std_logic_vector(7 downto 0);
                   signal d : out std_logic_vector(7 downto 0);
                   signal c : in std_logic;
                   variable sent : inout natural) is
    begin
      d <= v;
      wait until rising_edge(c);
      sent := sent + 1;
    end procedure;
    variable sent : natural := 0;
  begin
    count <= ones(x"0B") + ones(false);  -- 3
    wait for 10 ns;
    data <= x"07";                        -- three ones: odd parity
    wait for 1 ns;
    send(x"A5", data, clk, sent);
    send(x"3C", data, clk, sent);
    assert low_nibble = "1100" and top = '0' report "alias view is wrong" severity error;
    send(x"81", data, clk, sent);
    report "frames sent: " & integer'image(sent);
    mode <= "10";
    wait for 10 ns;
    mode <= "11";
    wait;
  end process;
end architecture;
