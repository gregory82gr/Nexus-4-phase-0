-- @top: numeric_std_traps
-- @stop: 10ns
-- @kernel: required
-- @purpose: The traps of numeric_std: wrap-around, sign, comparisons across lengths, and what happens with 'U' and 'X'.
-- @expect-report: "11111111" + 1 = 00 (wraps around)
-- @expect-report: as unsigned "01" = "0001" is true, as std_logic_vector it is false
-- @expect-report: NUMERIC_STD."<": metavalue detected, returning FALSE
-- @expect-report: the same bits "1000" < "0111": as signed true, as unsigned false
-- @expect-report: NUMERIC_STD.TO_INTEGER: metavalue detected, returning 0
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity numeric_std_traps is
end entity;

architecture rtl of numeric_std_traps is
begin
  demo : process
    variable u8 : unsigned(7 downto 0);
    variable s4 : signed(3 downto 0);
    variable n  : integer;
  begin
    u8 := "11111111";
    u8 := u8 + 1;
    report """11111111"" + 1 = " & to_hstring(u8) & " (wraps around)";

    s4 := to_signed(-3, 4);
    report "-3 as signed(3 downto 0) = " & to_string(s4) & ", resized to 8 bits = " & to_string(resize(s4, 8));
    report "shift_right keeps the sign of signed: " & to_string(shift_right(s4, 1)) &
           ", but not of unsigned: " & to_string(shift_right(unsigned(s4), 1));
    report "-(-8) on 4 bits = " & to_string(-to_signed(-8, 4)) & " (the most negative value has no positive twin)";
    report "the same bits ""1000"" < ""0111"": as signed " & boolean'image(signed'("1000") < signed'("0111")) &
           ", as unsigned " & boolean'image(unsigned'("1000") < unsigned'("0111"));
    report "signed -1 < 0 is " & boolean'image(to_signed(-1, 4) < 0) & ", signed -1 >= -8 is " & boolean'image(s4 >= -8);

    if unsigned'("01") = unsigned'("0001") and not (std_logic_vector'("01") = std_logic_vector'("0001")) then
      report "as unsigned ""01"" = ""0001"" is true, as std_logic_vector it is false";
    end if;
    report "as std_logic_vector, ""01"" < ""1"" is " & boolean'image(std_logic_vector'("01") < std_logic_vector'("1")) &
           " (compared character by character)";

    u8 := "0000ZZ01";
    if u8 < 3 then report "never printed"; end if;
    n := to_integer(u8);
    report "to_integer of a metavalue gives " & integer'image(n);
    u8 := u8 + 1;
    report "metavalue + 1 = " & to_string(u8);
    report "to_hstring: " & to_hstring(std_logic_vector'("ZZZZ0001")) & " " & to_hstring(std_logic_vector'("HL01")) &
           " " & to_hstring(signed'("101")) & " " & to_hstring(unsigned'("101"));
    wait;
  end process;
end architecture;
