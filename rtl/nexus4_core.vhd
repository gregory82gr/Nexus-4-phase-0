-- NEXUS-4 processor: the multi-cycle RV32I core (D13, D49).
-- MIT License, Copyright (c) 2026 Grigorios Agathangelidis.
--
-- Every instruction takes a fixed number of cycles, whatever its data (D12):
--   FETCH  the instruction scratchpad reads the word at pc;
--   DECODE the word arrives; it is kept in ir, and rs1 and rs2 are read into a and b;
--   EXEC   the ALU, the branch comparison and the address adder work on ir, a, b and pc;
--          everything but a load completes here: rd is written and pc moves on;
--   MEM    (loads only) the data scratchpad's word arrives and is written to rd.
-- So a load takes 4 cycles and every other instruction 3. A taken branch costs the same as one not taken.
--
-- There are no CSRs. A trap (an illegal instruction, ecall, ebreak, a misaligned or out-of-range
-- access or jump target) stops the core in HALT: the fail-safe stop (D48).
--
-- The commit port reports each instruction that completes or traps, for one cycle after it does,
-- so that the reference model can be compared with the core instruction by instruction (D24).
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

entity nexus4_core is
  generic (IMEM_WORDS : positive := 16384; DMEM_WORDS : positive := 16384);
  port (
    clk, rst     : in  std_logic;
    -- instruction scratchpad: the word at imem_addr arrives in imem_rdata one cycle later
    imem_addr    : out unsigned(31 downto 0);
    imem_rdata   : in  word_t;
    -- data scratchpad: likewise for reads; a write happens at the clock edge, in the lanes of dmem_be
    dmem_addr    : out unsigned(31 downto 0);
    dmem_wdata   : out word_t;
    dmem_be      : out std_logic_vector(3 downto 0);
    dmem_we      : out std_logic;
    dmem_rdata   : in  word_t;
    -- commit port
    commit       : out std_logic;
    commit_pc    : out word_t;
    commit_insn  : out word_t;
    commit_rd    : out natural range 0 to 31;   -- 0: no register written
    commit_wdata : out word_t;
    commit_mem   : out std_logic_vector(1 downto 0);
    commit_maddr : out word_t;
    commit_mdata : out word_t;                  -- the value stored (in its lanes' width, zero-extended)
    commit_trap  : out std_logic;
    commit_cause : out natural range 0 to 15;
    commit_tval  : out word_t;
    halted       : out std_logic);
end entity;

architecture rtl of nexus4_core is
  type state_t is (S_FETCH, S_DECODE, S_EXEC, S_MEM, S_HALT);

  signal state : state_t := S_FETCH;
  signal pc    : unsigned(31 downto 0) := IMEM_BASE;
  signal ir    : word_t := (others => '0');
  signal a, b  : word_t := (others => '0');            -- rs1 and rs2, read in DECODE
  signal regs  : word_array(0 to 31) := (others => (others => '0'));

  -- what EXEC works out from ir, a, b and pc (combinational)
  signal imm        : word_t;
  signal alu_y      : word_t;                          -- the value for rd (pc + 4 for jumps)
  signal next_pc    : unsigned(31 downto 0);
  signal mem_addr   : unsigned(31 downto 0);
  signal writes_rd  : boolean;
  signal is_load    : boolean;
  signal is_store   : boolean;
  signal trap       : boolean;
  signal trap_cause : natural range 0 to 15;
  signal trap_tval  : word_t;
  signal store_data : word_t;
  signal store_be   : std_logic_vector(3 downto 0);

  -- kept for MEM: how to extract the loaded value
  signal ld_f3   : std_logic_vector(2 downto 0) := "000";
  signal ld_lane : unsigned(1 downto 0) := "00";
  signal ld_addr : unsigned(31 downto 0) := (others => '0');

  constant IMEM_END : unsigned(31 downto 0) := IMEM_BASE + to_unsigned(4 * IMEM_WORDS, 32);
  constant DMEM_END : unsigned(31 downto 0) := DMEM_BASE + to_unsigned(4 * DMEM_WORDS, 32);
begin
  imem_addr <= pc;

  -- ===== decode and execute: everything EXEC needs, from ir, a, b and pc =====
  execute : process (all)
    variable opcode   : std_logic_vector(6 downto 0);
    variable f3       : std_logic_vector(2 downto 0);
    variable f7       : std_logic_vector(6 downto 0);
    variable i_imm, s_imm, b_imm, u_imm, j_imm : signed(31 downto 0);
    variable op2      : unsigned(31 downto 0);
    variable shamt    : natural range 0 to 31;
    variable y        : unsigned(31 downto 0);
    variable legal    : boolean;
    variable taken    : boolean;
    variable target   : unsigned(31 downto 0);
    variable addr     : unsigned(31 downto 0);
    variable size     : natural range 1 to 4;
    variable s_bits   : std_logic_vector(11 downto 0);
    variable b_bits   : std_logic_vector(12 downto 0);
    variable u_bits   : std_logic_vector(31 downto 0);
    variable j_bits   : std_logic_vector(20 downto 0);
  begin
    opcode := ir(6 downto 0);
    f3 := ir(14 downto 12);
    f7 := ir(31 downto 25);
    i_imm := resize(signed(ir(31 downto 20)), 32);
    -- the immediates: the same bits, scattered differently in each format
    s_bits := ir(31 downto 25) & ir(11 downto 7);
    b_bits := ir(31) & ir(7) & ir(30 downto 25) & ir(11 downto 8) & '0';
    u_bits := ir(31 downto 12) & x"000";
    j_bits := ir(31) & ir(19 downto 12) & ir(20) & ir(30 downto 21) & '0';
    s_imm := resize(signed(s_bits), 32);
    b_imm := resize(signed(b_bits), 32);
    u_imm := signed(u_bits);
    j_imm := resize(signed(j_bits), 32);

    legal := false;
    taken := false;
    writes_rd <= false;
    is_load <= false;
    is_store <= false;
    y := (others => '0');
    target := pc + 4;
    addr := unsigned(a) + unsigned(i_imm);
    size := 4;
    imm <= std_logic_vector(i_imm);

    case opcode is
      when "0110111" =>                                   -- lui
        legal := true; writes_rd <= true; y := unsigned(u_imm); imm <= std_logic_vector(u_imm);
      when "0010111" =>                                   -- auipc
        legal := true; writes_rd <= true; y := pc + unsigned(u_imm); imm <= std_logic_vector(u_imm);
      when "1101111" =>                                   -- jal
        legal := true; writes_rd <= true; y := pc + 4; taken := true;
        target := pc + unsigned(j_imm); imm <= std_logic_vector(j_imm);
      when "1100111" =>                                   -- jalr
        if f3 = "000" then
          legal := true; writes_rd <= true; y := pc + 4; taken := true;
          target := (unsigned(a) + unsigned(i_imm)) and x"FFFFFFFE";
        end if;
      when "1100011" =>                                   -- branches
        imm <= std_logic_vector(b_imm);
        legal := true;
        case f3 is
          when "000" => taken := a = b;
          when "001" => taken := a /= b;
          when "100" => taken := signed(a) < signed(b);
          when "101" => taken := signed(a) >= signed(b);
          when "110" => taken := unsigned(a) < unsigned(b);
          when "111" => taken := unsigned(a) >= unsigned(b);
          when others => legal := false;
        end case;
        if taken then
          target := pc + unsigned(b_imm);
        end if;
      when "0000011" =>                                   -- loads
        case f3 is
          when "000" | "100" => legal := true; size := 1;
          when "001" | "101" => legal := true; size := 2;
          when "010"         => legal := true; size := 4;
          when others => null;
        end case;
        if legal then is_load <= true; writes_rd <= true; end if;
      when "0100011" =>                                   -- stores
        addr := unsigned(a) + unsigned(s_imm);
        imm <= std_logic_vector(s_imm);
        case f3 is
          when "000" => legal := true; size := 1;
          when "001" => legal := true; size := 2;
          when "010" => legal := true; size := 4;
          when others => null;
        end case;
        if legal then is_store <= true; end if;
      when "0010011" | "0110011" =>                       -- OP-IMM and OP
        if opcode = "0010011" then
          op2 := unsigned(i_imm);
          -- shifts by an immediate: funct7 must be 0, or 0100000 for srai
          legal := (f3 /= "001" and f3 /= "101") or f7 = "0000000" or (f3 = "101" and f7 = "0100000");
        else
          op2 := unsigned(b);
          legal := f7 = "0000000" or (f7 = "0100000" and (f3 = "000" or f3 = "101"));
        end if;
        shamt := to_integer(op2(4 downto 0));
        case f3 is
          when "000" =>
            if opcode = "0110011" and f7(5) = '1' then y := unsigned(a) - op2; else y := unsigned(a) + op2; end if;
          when "001" => y := shift_left(unsigned(a), shamt);
          when "010" => if signed(a) < signed(op2) then y := to_unsigned(1, 32); end if;
          when "011" => if unsigned(a) < op2 then y := to_unsigned(1, 32); end if;
          when "100" => y := unsigned(a) xor op2;
          when "101" =>
            if f7(5) = '1' then y := unsigned(shift_right(signed(a), shamt)); else y := shift_right(unsigned(a), shamt); end if;
          when "110" => y := unsigned(a) or op2;
          when others => y := unsigned(a) and op2;
        end case;
        writes_rd <= legal;
      when "0001111" =>                                   -- fence: one hart, no caches, nothing to order
        legal := f3 = "000";
      when others =>
        null;
    end case;

    -- traps, in the order the reference model (and Spike) report them
    trap <= false;
    trap_cause <= 0;
    trap_tval <= (others => '0');
    if ir = x"00000073" then
      trap <= true; trap_cause <= CAUSE_ECALL;
    elsif ir = x"00100073" then
      trap <= true; trap_cause <= CAUSE_BREAKPOINT; trap_tval <= std_logic_vector(pc);
    elsif not legal then
      trap <= true; trap_cause <= CAUSE_ILLEGAL; trap_tval <= ir;
    elsif taken and target(1 downto 0) /= "00" then
      trap <= true; trap_cause <= CAUSE_FETCH_MISALIGNED; trap_tval <= std_logic_vector(target);
    elsif opcode = "0000011" or opcode = "0100011" then
      if (size = 2 and addr(0) /= '0') or (size = 4 and addr(1 downto 0) /= "00") then
        trap <= true; trap_tval <= std_logic_vector(addr);
        if opcode = "0000011" then trap_cause <= CAUSE_LOAD_MISALIGNED; else trap_cause <= CAUSE_STORE_MISALIGNED; end if;
      elsif addr < DMEM_BASE or addr > DMEM_END - size then
        trap <= true; trap_tval <= std_logic_vector(addr);
        if opcode = "0000011" then trap_cause <= CAUSE_LOAD_FAULT; else trap_cause <= CAUSE_STORE_FAULT; end if;
      end if;
    end if;

    alu_y <= std_logic_vector(y);
    next_pc <= target;
    mem_addr <= addr;

    -- a store's data and byte lanes
    case size is
      when 1 =>
        store_data <= b(7 downto 0) & b(7 downto 0) & b(7 downto 0) & b(7 downto 0);
        case addr(1 downto 0) is
          when "00" => store_be <= "0001";
          when "01" => store_be <= "0010";
          when "10" => store_be <= "0100";
          when others => store_be <= "1000";
        end case;
      when 2 =>
        store_data <= b(15 downto 0) & b(15 downto 0);
        if addr(1) = '0' then store_be <= "0011"; else store_be <= "1100"; end if;
      when others =>
        store_data <= b;
        store_be <= "1111";
    end case;
  end process;

  -- the data scratchpad sees the address in EXEC; it writes only for a store that does not trap
  dmem_addr  <= mem_addr;
  dmem_wdata <= store_data;
  dmem_be    <= store_be;
  dmem_we    <= '1' when state = S_EXEC and is_store and not trap else '0';

  -- ===== the control state machine, the register file and the commit port =====
  control : process (clk)
    variable rd     : natural range 0 to 31;
    variable lane_data : word_t;
    variable loaded : word_t;
    variable mdata  : word_t;
  begin
    if rising_edge(clk) then
      commit <= '0';
      if rst = '1' then
        state <= S_FETCH;
        pc <= IMEM_BASE;
        halted <= '0';
        commit_pc <= (others => '0'); commit_insn <= (others => '0'); commit_rd <= 0;
        commit_wdata <= (others => '0'); commit_mem <= MEM_NONE; commit_maddr <= (others => '0');
        commit_mdata <= (others => '0'); commit_trap <= '0'; commit_cause <= 0; commit_tval <= (others => '0');
      else
        case state is
          when S_FETCH =>
            if pc >= IMEM_END then                       -- outside the instruction scratchpad
              commit <= '1'; commit_trap <= '1'; commit_cause <= CAUSE_FETCH_FAULT;
              commit_pc <= std_logic_vector(pc); commit_insn <= (others => '0');
              commit_tval <= std_logic_vector(pc);
              commit_rd <= 0; commit_mem <= MEM_NONE;
              state <= S_HALT;
            else
              state <= S_DECODE;
            end if;

          when S_DECODE =>
            ir <= imem_rdata;
            a <= regs(to_integer(unsigned(imem_rdata(19 downto 15))));
            b <= regs(to_integer(unsigned(imem_rdata(24 downto 20))));
            state <= S_EXEC;

          when S_EXEC =>
            rd := to_integer(unsigned(ir(11 downto 7)));
            commit <= '1';
            commit_pc <= std_logic_vector(pc);
            commit_insn <= ir;
            commit_rd <= 0;
            commit_mem <= MEM_NONE;
            commit_trap <= '0';
            if trap then
              commit_trap <= '1'; commit_cause <= trap_cause; commit_tval <= trap_tval;
              state <= S_HALT;
            elsif is_load then
              commit <= '0';                              -- it commits in MEM
              ld_f3 <= ir(14 downto 12);
              ld_lane <= mem_addr(1 downto 0);
              ld_addr <= mem_addr;
              state <= S_MEM;
            else
              if writes_rd and rd /= 0 then
                regs(rd) <= alu_y;
                commit_rd <= rd;
                commit_wdata <= alu_y;
              end if;
              if is_store then
                commit_mem <= MEM_STORE;
                commit_maddr <= std_logic_vector(mem_addr);
                case ir(13 downto 12) is
                  when "00"   => mdata := x"000000" & b(7 downto 0);
                  when "01"   => mdata := x"0000" & b(15 downto 0);
                  when others => mdata := b;
                end case;
                commit_mdata <= mdata;
              end if;
              pc <= next_pc;
              state <= S_FETCH;
            end if;

          when S_MEM =>
            -- the byte or half-word the load asked for, moved down to bit 0
            case ld_lane is
              when "00"   => lane_data := dmem_rdata;
              when "01"   => lane_data := x"00" & dmem_rdata(31 downto 8);
              when "10"   => lane_data := x"0000" & dmem_rdata(31 downto 16);
              when others => lane_data := x"000000" & dmem_rdata(31 downto 24);
            end case;
            case ld_f3 is
              when "000" => loaded := std_logic_vector(resize(signed(lane_data(7 downto 0)), 32));
              when "100" => loaded := std_logic_vector(resize(unsigned(lane_data(7 downto 0)), 32));
              when "001" => loaded := std_logic_vector(resize(signed(lane_data(15 downto 0)), 32));
              when "101" => loaded := std_logic_vector(resize(unsigned(lane_data(15 downto 0)), 32));
              when others => loaded := lane_data;
            end case;
            rd := to_integer(unsigned(ir(11 downto 7)));
            commit <= '1';
            commit_pc <= std_logic_vector(pc);
            commit_insn <= ir;
            commit_trap <= '0';
            commit_rd <= 0;
            if rd /= 0 then
              regs(rd) <= loaded;
              commit_rd <= rd;
              commit_wdata <= loaded;
            end if;
            commit_mem <= MEM_LOAD;
            commit_maddr <= std_logic_vector(ld_addr);
            pc <= pc + 4;
            state <= S_FETCH;

          when S_HALT =>
            halted <= '1';
        end case;
      end if;
    end if;
  end process;
end architecture;

-- ===== the scratchpads =====
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

-- Instruction scratchpad: a ROM with a registered read.
entity nexus4_imem is
  generic (WORDS : positive; IMAGE : word_array);
  port (clk : in std_logic; addr : in unsigned(31 downto 0); rdata : out word_t := (others => '0'));
end entity;

architecture rtl of nexus4_imem is
  constant ROM : word_array(0 to WORDS - 1) := memory_image(IMAGE, WORDS);
begin
  process (clk)
    variable i : natural;
  begin
    if rising_edge(clk) then
      i := to_integer(shift_right(addr - IMEM_BASE, 2));
      if addr >= IMEM_BASE and i < WORDS then
        rdata <= ROM(i);
      end if;
    end if;
  end process;
end architecture;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

-- Data scratchpad: registered read, byte-lane writes.
entity nexus4_dmem is
  generic (WORDS : positive; IMAGE : word_array);
  port (
    clk   : in  std_logic;
    addr  : in  unsigned(31 downto 0);
    wdata : in  word_t;
    be    : in  std_logic_vector(3 downto 0);
    we    : in  std_logic;
    rdata : out word_t := (others => '0'));
end entity;

architecture rtl of nexus4_dmem is
  signal ram : word_array(0 to WORDS - 1) := memory_image(IMAGE, WORDS);
begin
  process (clk)
    variable i : natural;
    variable w : word_t;
  begin
    if rising_edge(clk) then
      if addr >= DMEM_BASE and addr < DMEM_BASE + to_unsigned(4 * WORDS, 32) then
        i := to_integer(shift_right(addr - DMEM_BASE, 2));
        if we = '1' then
          w := ram(i);
          if be(0) = '1' then w(7 downto 0)   := wdata(7 downto 0);   end if;
          if be(1) = '1' then w(15 downto 8)  := wdata(15 downto 8);  end if;
          if be(2) = '1' then w(23 downto 16) := wdata(23 downto 16); end if;
          if be(3) = '1' then w(31 downto 24) := wdata(31 downto 24); end if;
          ram(i) <= w;
        end if;
        rdata <= ram(i);
      end if;
    end if;
  end process;
end architecture;
