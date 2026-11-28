-- @top: mixed_logic
-- @kernel-refuses: error: only one kind of logical operator may combine relations without parentheses: 'xor' and 'or'
-- @ghdl: refuses: only one type of logical operators may be used to combine relation
-- @purpose: LRM 9.1: relations are combined with one kind of logical operator, and nand or nor at most once, unless
-- @purpose: parentheses group them. The kernel accepted this until decision D72 (found by the book's Chapter 13).
library ieee;
use ieee.std_logic_1164.all;

entity mixed_logic is
end entity;

architecture rtl of mixed_logic is
  signal a, b, cin, s : std_logic := '0';
begin
  s <= a xor b or cin;
end architecture;
