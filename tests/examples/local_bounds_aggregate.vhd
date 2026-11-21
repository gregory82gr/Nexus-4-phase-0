-- @top: local_bounds_aggregate
-- @stop: 10ns
-- @kernel: required
-- @purpose: A function's local array whose bounds come from a parameter, initialised with (others => ...): the
-- @purpose: aggregate takes its length from each call. The processor builds its scratchpad images this way.
-- @expect-report: image of 3 words in 5: 00000001 00000002 00000003 00000000 00000000
-- @expect-report: image of 3 words in 2: 00000001 00000002
library ieee;
use ieee.std_logic_1164.all;

entity local_bounds_aggregate is
end entity;

architecture sim of local_bounds_aggregate is
  type word_array is array (natural range <>) of std_logic_vector(31 downto 0);

  -- the first `words` words of src, then zeros
  function image(src : word_array; words : positive) return word_array is
    variable r : word_array(0 to words - 1) := (others => (others => '0'));
  begin
    for i in 0 to src'length - 1 loop
      if i < words then
        r(i) := src(src'low + i);
      end if;
    end loop;
    return r;
  end function;

  constant SRC : word_array := (x"00000001", x"00000002", x"00000003");
  constant BIG : word_array := image(SRC, 5);
  constant SMALL : word_array := image(SRC, 2);
begin
  process
  begin
    report "image of 3 words in 5: " & to_hstring(BIG(0)) & " " & to_hstring(BIG(1)) & " " & to_hstring(BIG(2)) & " " &
           to_hstring(BIG(3)) & " " & to_hstring(BIG(4));
    report "image of 3 words in 2: " & to_hstring(SMALL(0)) & " " & to_hstring(SMALL(1));
    wait;
  end process;
end architecture;
