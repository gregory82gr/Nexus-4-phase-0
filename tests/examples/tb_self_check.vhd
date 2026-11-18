-- @top: tb_self_check
-- @stop: 200ns
-- @kernel: required
-- @purpose: A self-checking testbench in the usual shape: a clock, a reset, a table of test cases, a check procedure
-- @purpose: that counts errors, and a summary at the end. The device under test is a saturating counter.
-- @expect-report: PASS: 8 checks, 0 errors
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sat_counter is
  generic (MAX : natural := 5);
  port (clk, rst, en : in std_logic; count : out natural range 0 to MAX; at_max : out std_logic);
end entity;

architecture rtl of sat_counter is
  signal n : natural range 0 to MAX := 0;
begin
  process (clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        n <= 0;
      elsif en = '1' and n < MAX then
        n <= n + 1;
      end if;
    end if;
  end process;
  count <= n;
  at_max <= '1' when n = MAX else '0';
end architecture;

library ieee;
use ieee.std_logic_1164.all;

entity tb_self_check is
end entity;

architecture sim of tb_self_check is
  constant PERIOD : time := 10 ns;
  signal clk, rst, en : std_logic := '0';
  signal count : natural range 0 to 3;
  signal at_max : std_logic;
  signal done : boolean := false;

  -- one test case: drive en for one edge, then expect these outputs
  type case_t is record
    count  : natural;
    en     : std_logic;
    at_max : std_logic;
  end record;
  type cases_t is array (0 to 7) of case_t;
  constant CASES : cases_t := (
    (en => '1', count => 1, at_max => '0'), (en => '1', count => 2, at_max => '0'),
    (en => '0', count => 2, at_max => '0'), (en => '1', count => 3, at_max => '1'),
    (en => '1', count => 3, at_max => '1'),      -- saturates: stays at MAX
    (en => '0', count => 3, at_max => '1'), (en => '1', count => 3, at_max => '1'),
    (en => '0', count => 3, at_max => '1'));
begin
  dut : entity work.sat_counter generic map (MAX => 3)
    port map (clk => clk, rst => rst, en => en, count => count, at_max => at_max);

  clk <= not clk after PERIOD / 2 when not done;   -- the clock stops when the test is over

  test : process
    variable errors, checks : natural := 0;
    procedure check(actual, expected : natural; what : string) is
    begin
      checks := checks + 1;
      if actual /= expected then
        errors := errors + 1;
        report what & ": expected " & integer'image(expected) & ", got " & integer'image(actual) severity error;
      end if;
    end procedure;
  begin
    rst <= '1';
    wait until rising_edge(clk);
    rst <= '0';
    for i in CASES'range loop
      en <= CASES(i).en;
      wait until rising_edge(clk);
      wait for 1 ns;                                 -- let the outputs settle after the edge
      check(count, CASES(i).count, "count in case " & integer'image(i));
      assert at_max = CASES(i).at_max report "at_max in case " & integer'image(i) severity error;
    end loop;
    if errors = 0 then
      report "PASS: " & integer'image(checks) & " checks, 0 errors";
    else
      report "FAIL: " & integer'image(errors) & " errors" severity failure;
    end if;
    done <= true;
    wait;
  end process;
end architecture;
