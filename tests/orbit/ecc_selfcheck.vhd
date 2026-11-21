-- @top: ecc_selfcheck
-- @stop: 10ns
-- The SEC-DED code of ORBIT (D56), checked exhaustively on four data words: the Hsiao (39,32) code of
-- nexus4_pkg must correct every single-bit error in the 39 bits (32 data bits and 7 check bits) and
-- report every double-bit error as uncorrectable (741 pairs), and never miscorrect one. tools/core-check.mjs
-- runs this on GHDL and on the NEXUS-4 kernel and compares the two, delta cycle by delta cycle.
library ieee;
use ieee.std_logic_1164.all;
use work.nexus4_pkg.all;

entity ecc_selfcheck is
end entity;

architecture sim of ecc_selfcheck is
  type words_t is array (0 to 3) of word_t;
  constant DATA : words_t := (x"00000000", x"FFFFFFFF", x"A5A5C3C3", x"12345678");
  signal singles_fixed, doubles_found : natural := 0;
begin
  process
    variable code, bad : std_logic_vector(38 downto 0);   -- bits 31-0 the word, 38-32 the check bits
    variable w : word_t;
    variable c : chk_t;
    variable ns, nd, wrong : natural := 0;
  begin
    for k in DATA'range loop
      code := ecc_check(DATA(k)) & DATA(k);
      assert ecc_state(DATA(k), ecc_check(DATA(k))) = 0 report "a good word reported as wrong" severity error;
      for i in 0 to 38 loop
        bad := code;
        bad(i) := not bad(i);
        w := bad(31 downto 0); c := bad(38 downto 32);
        if ecc_state(w, c) = 1 and ecc_fix(w, c) = DATA(k) then ns := ns + 1; else wrong := wrong + 1; end if;
        for j in i + 1 to 38 loop
          bad := code;
          bad(i) := not bad(i);
          bad(j) := not bad(j);
          w := bad(31 downto 0); c := bad(38 downto 32);
          if ecc_state(w, c) = 2 then nd := nd + 1; else wrong := wrong + 1; end if;
        end loop;
      end loop;
    end loop;
    singles_fixed <= ns;
    doubles_found <= nd;
    report "singles corrected " & integer'image(ns) & " of 156, doubles detected " & integer'image(nd) &
           " of 2964, wrong " & integer'image(wrong);
    wait;
  end process;
end architecture;
