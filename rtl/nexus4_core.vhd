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
--
-- ORBIT (D56): the register file, ir, a and b keep check bits of a SEC-DED code beside their words,
-- and are corrected where they are used; the instruction and data words arrive with theirs. The pc and
-- the control state are kept three times and voted every cycle. In FETCH, when nothing else uses the
-- register file, one register is checked and corrected (scrubbing). An error the code cannot correct
-- stops the core before it does anything with the bad word (due): the system then restarts it.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

entity nexus4_core is
  generic (IMEM_WORDS : positive := 16384; DMEM_WORDS : positive := 16384; ORBIT : boolean := false);
  port (
    clk, rst     : in  std_logic;
    stop         : in  std_logic := '0';         -- a hardware trip (PLANT): go to HALT at the next edge
    imem_rchk    : in  chk_t := (others => '0');  -- ORBIT: the check bits of imem_rdata and dmem_rdata
    dmem_rchk    : in  chk_t := (others => '0');
    due          : out std_logic;                -- ORBIT: an error the code cannot correct, in this cycle
    corrected    : out std_logic;                -- ORBIT: a single-bit error corrected in this cycle
    phase        : out std_logic_vector(1 downto 0);   -- the control state, for the scratchpads' scrubbing
    -- instruction scratchpad: the word at imem_addr arrives in imem_rdata one cycle later
    imem_addr    : out unsigned(31 downto 0);
    imem_rdata   : in  word_t;
    -- data scratchpad: likewise for reads; a write happens at the clock edge, in the lanes of dmem_be
    dmem_addr    : out unsigned(31 downto 0);
    dmem_wdata   : out word_t;
    dmem_be      : out std_logic_vector(3 downto 0);
    dmem_we      : out std_logic;
    dmem_re      : out std_logic;                -- a load reads the word at dmem_addr at this edge
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

  -- the registers; ORBIT keeps the state and the pc three times, and check bits beside ir, a, b and regs
  signal state_r, state_b, state_c : state_t := S_FETCH;
  signal pc_r, pc_b, pc_c : unsigned(31 downto 0) := IMEM_BASE;
  signal ir_r  : word_t := (others => '0');
  signal a_r, b_r : word_t := (others => '0');          -- rs1 and rs2, read in DECODE
  signal ir_c, a_c, b_c : chk_t := (others => '0');
  signal regs  : word_array(0 to 31) := (others => (others => '0'));
  signal regs_chk : chk_array(0 to 31) := (others => (others => '0'));
  signal scrub_ptr : natural range 0 to 31 := 0;
  -- the values everything else uses: the registers themselves, or (ORBIT) voted and corrected
  signal state : state_t;
  signal pc    : unsigned(31 downto 0);
  signal ir, a, b : word_t;
  signal due_now, corr_now : std_logic;
  -- ORBIT, for the views: which word checked in this cycle had a single-bit error (ecc_fix_at) or one the
  -- code cannot correct (ecc_due_at). Bit 0 the register being scrubbed, 1 the instruction word, 2 ir,
  -- 3 a, 4 b, 5 the loaded word.
  signal ecc_fix_at, ecc_due_at : std_logic_vector(5 downto 0);

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
  function vote(x, y, z : state_t) return state_t is
  begin
    if x = y or x = z then return x; else return y; end if;
  end function;
begin
  state <= vote(state_r, state_b, state_c) when ORBIT else state_r;
  pc    <= (pc_r and pc_b) or (pc_r and pc_c) or (pc_b and pc_c) when ORBIT else pc_r;
  ir    <= ecc_fix(ir_r, ir_c) when ORBIT else ir_r;
  a     <= ecc_fix(a_r, a_c) when ORBIT else a_r;
  b     <= ecc_fix(b_r, b_c) when ORBIT else b_r;
  imem_addr <= pc;
  phase <= "00" when state = S_FETCH else "01" when state = S_DECODE else "10" when state = S_EXEC else "11";

  -- ORBIT: the words this cycle uses, checked (FETCH: the register being scrubbed; DECODE: the instruction
  -- word; EXEC: ir, a and b; MEM: the loaded word)
  ecc_watch : process (all)
    variable worst, fixes : natural;
    variable fx, du : std_logic_vector(5 downto 0);
    procedure see(k : natural; w : word_t; c : chk_t) is
      variable st : natural;
    begin
      st := ecc_state(w, c);
      if st = 2 then worst := 2; du(k) := '1'; elsif st = 1 then fixes := fixes + 1; fx(k) := '1'; end if;
    end procedure;
  begin
    worst := 0; fixes := 0; fx := (others => '0'); du := (others => '0');
    if ORBIT then
      case state is
        when S_FETCH  => see(0, regs(scrub_ptr), regs_chk(scrub_ptr));
        when S_DECODE => see(1, imem_rdata, imem_rchk);
        when S_EXEC   => see(2, ir_r, ir_c); see(3, a_r, a_c); see(4, b_r, b_c);
        when S_MEM    => see(5, dmem_rdata, dmem_rchk);
        when others   => null;
      end case;
    end if;
    if worst = 2 then due_now <= '1'; else due_now <= '0'; end if;
    if worst /= 2 and fixes > 0 then corr_now <= '1'; else corr_now <= '0'; end if;
    ecc_fix_at <= fx;
    ecc_due_at <= du;
  end process;
  due <= due_now;
  corrected <= corr_now;

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
      elsif addr >= IO_BASE and addr < IO_END then
        if size /= 4 then                                -- the I/O page takes whole words only
          trap <= true; trap_tval <= std_logic_vector(addr);
          if opcode = "0000011" then trap_cause <= CAUSE_LOAD_FAULT; else trap_cause <= CAUSE_STORE_FAULT; end if;
        end if;
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
  dmem_we    <= '1' when state = S_EXEC and is_store and not trap and due_now = '0' else '0';
  dmem_re    <= '1' when state = S_EXEC and is_load and not trap and due_now = '0' else '0';

  -- ===== the control state machine, the register file and the commit port =====
  control : process (clk)
    variable rd     : natural range 0 to 31;
    variable lane_data : word_t;
    variable loaded : word_t;
    variable mdata  : word_t;
    variable iw, dw, sw : word_t;
    variable lane   : unsigned(1 downto 0);
    variable f3     : std_logic_vector(2 downto 0);
    variable nstate : state_t;
    variable npc    : unsigned(31 downto 0);
  begin
    if rising_edge(clk) then
      commit <= '0';
      if rst = '1' then
        state_r <= S_FETCH; state_b <= S_FETCH; state_c <= S_FETCH;
        pc_r <= IMEM_BASE; pc_b <= IMEM_BASE; pc_c <= IMEM_BASE;
        if ORBIT then                                    -- a restart starts from a clean register file
          for i in 0 to 31 loop
            regs(i) <= (others => '0'); regs_chk(i) <= (others => '0');
          end loop;
          scrub_ptr <= 0;
        end if;
        halted <= '0';
        commit_pc <= (others => '0'); commit_insn <= (others => '0'); commit_rd <= 0;
        commit_wdata <= (others => '0'); commit_mem <= MEM_NONE; commit_maddr <= (others => '0');
        commit_mdata <= (others => '0'); commit_trap <= '0'; commit_cause <= 0; commit_tval <= (others => '0');
      elsif (stop = '1' or due_now = '1') and state /= S_HALT then
        -- a hardware trip, or an error the code cannot correct: no further instruction completes
        state_r <= S_HALT; pc_r <= pc;
        if ORBIT then
          state_b <= S_HALT; state_c <= S_HALT; pc_b <= pc; pc_c <= pc;
        end if;
      else
        nstate := state;
        npc := pc;
        case state is
          when S_FETCH =>
            if pc >= IMEM_END then                       -- outside the instruction scratchpad
              commit <= '1'; commit_trap <= '1'; commit_cause <= CAUSE_FETCH_FAULT;
              commit_pc <= std_logic_vector(pc); commit_insn <= (others => '0');
              commit_tval <= std_logic_vector(pc);
              commit_rd <= 0; commit_mem <= MEM_NONE;
              nstate := S_HALT;
            else
              nstate := S_DECODE;
            end if;
            if ORBIT then                                -- scrub one register: nothing else uses them now
              sw := regs(scrub_ptr);
              if ecc_state(sw, regs_chk(scrub_ptr)) = 1 then
                regs(scrub_ptr) <= ecc_fix(sw, regs_chk(scrub_ptr));
                regs_chk(scrub_ptr) <= ecc_check(ecc_fix(sw, regs_chk(scrub_ptr)));
              end if;
              if scrub_ptr = 31 then scrub_ptr <= 0; else scrub_ptr <= scrub_ptr + 1; end if;
            end if;

          when S_DECODE =>
            if ORBIT then iw := ecc_fix(imem_rdata, imem_rchk); else iw := imem_rdata; end if;
            ir_r <= iw;
            ir_c <= ecc_check(iw);
            a_r <= regs(to_integer(unsigned(iw(19 downto 15))));
            a_c <= regs_chk(to_integer(unsigned(iw(19 downto 15))));
            b_r <= regs(to_integer(unsigned(iw(24 downto 20))));
            b_c <= regs_chk(to_integer(unsigned(iw(24 downto 20))));
            nstate := S_EXEC;

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
              nstate := S_HALT;
            elsif is_load then
              commit <= '0';                              -- it commits in MEM
              ld_f3 <= ir(14 downto 12);
              ld_lane <= mem_addr(1 downto 0);
              ld_addr <= mem_addr;
              nstate := S_MEM;
            else
              if writes_rd and rd /= 0 then
                regs(rd) <= alu_y;
                regs_chk(rd) <= ecc_check(alu_y);
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
              npc := next_pc;
              nstate := S_FETCH;
            end if;

          when S_MEM =>
            -- the byte or half-word the load asked for, moved down to bit 0
            if ORBIT then dw := ecc_fix(dmem_rdata, dmem_rchk); else dw := dmem_rdata; end if;
            -- which lane and how to extend it: kept from EXEC; in ORBIT taken again from ir and a, which
            -- are still held and are protected, rather than from two registers that are not
            if ORBIT then lane := mem_addr(1 downto 0); f3 := ir(14 downto 12); else lane := ld_lane; f3 := ld_f3; end if;
            case lane is
              when "00"   => lane_data := dw;
              when "01"   => lane_data := x"00" & dw(31 downto 8);
              when "10"   => lane_data := x"0000" & dw(31 downto 16);
              when others => lane_data := x"000000" & dw(31 downto 24);
            end case;
            case f3 is
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
              regs_chk(rd) <= ecc_check(loaded);
              commit_rd <= rd;
              commit_wdata <= loaded;
            end if;
            commit_mem <= MEM_LOAD;
            commit_maddr <= std_logic_vector(ld_addr);
            npc := pc + 4;
            nstate := S_FETCH;

          when S_HALT =>
            halted <= '1';
        end case;
        -- the state and the pc are written every cycle; in ORBIT all three copies, so a copy that an upset
        -- changed is outvoted now and corrected at this edge
        state_r <= nstate;
        pc_r <= npc;
        if ORBIT then
          state_b <= nstate; state_c <= nstate;
          pc_b <= npc; pc_c <= npc;
        end if;
      end if;
    end if;
  end process;
end architecture;

-- ===== the scratchpads =====
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

-- Instruction scratchpad: a ROM with a registered read. The ROM is a signal that no process drives, not
-- a constant: in operation its contents never change, but a fault campaign can upset one of its bits
-- (an SEU in the code, D52), which a constant could not hold. Each word has a parity bit beside it
-- (PLANT, D55) and SEC-DED check bits (ORBIT, D56), read with it. In ORBIT a scrubber walks the words:
-- it reads one at the edge that ends DECODE and, if one of its bits was wrong, writes it back corrected
-- at the edge that ends EXEC. The instruction scratchpad is read only at the end of FETCH, so the
-- scrubber never delays an instruction. An uncorrectable word is reported (due).
entity nexus4_imem is
  generic (WORDS : positive; IMAGE : word_array; ORBIT : boolean := false);
  port (clk, rst : in std_logic; addr : in unsigned(31 downto 0); phase : in std_logic_vector(1 downto 0) := "11";
        rdata : out word_t := (others => '0'); rpar : out std_logic := '0'; rchk : out chk_t := (others => '0');
        due, corrected : out std_logic := '0');
end entity;

architecture rtl of nexus4_imem is
  signal rom : word_array(0 to WORDS - 1) := memory_image(IMAGE, WORDS);
  signal par : std_logic_vector(0 to WORDS - 1) := parity_image(IMAGE, WORDS);
  signal chk : chk_array(0 to WORDS - 1) := chk_image(IMAGE, WORDS);
  signal sp : natural range 0 to WORDS - 1 := 0;
  signal sword : word_t := (others => '0');
  signal schk : chk_t := (others => '0');
begin
  process (clk)
    variable i : natural;
  begin
    if rising_edge(clk) then
      due <= '0'; corrected <= '0';
      i := to_integer(shift_right(addr - IMEM_BASE, 2));
      if addr >= IMEM_BASE and i < WORDS then
        rdata <= rom(i);
        rpar <= par(i);
        rchk <= chk(i);
      end if;
      if ORBIT and rst = '0' then
        if phase = "01" then                          -- end of DECODE: read the next word to check
          sword <= rom(sp); schk <= chk(sp);
        elsif phase = "10" then                       -- end of EXEC: write it back if it needs it
          if ecc_state(sword, schk) = 1 then
            rom(sp) <= ecc_fix(sword, schk); chk(sp) <= ecc_check(ecc_fix(sword, schk)); corrected <= '1';
          elsif ecc_state(sword, schk) = 2 then
            due <= '1';
          end if;
          if sp = WORDS - 1 then sp <= 0; else sp <= sp + 1; end if;
        end if;
      end if;
    end if;
  end process;
end architecture;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

-- Data scratchpad: registered read, byte-lane writes, a parity bit (PLANT) and SEC-DED check bits
-- (ORBIT) per word. A write of some lanes merges with the word already there, so it first checks that
-- word (perr; in ORBIT it corrects it, or reports due): otherwise the new parity or check bits would
-- cover an upset in the lanes it keeps. In ORBIT a scrubber reads one word at the edge that ends FETCH
-- and writes it back corrected, if it must, at the edge that ends DECODE: the two cycles in which no
-- instruction uses the data scratchpad, so scrubbing costs no instruction a cycle (D52).
entity nexus4_dmem is
  generic (WORDS : positive; IMAGE : word_array; ORBIT : boolean := false);
  port (
    clk   : in  std_logic;
    rst   : in  std_logic := '0';
    addr  : in  unsigned(31 downto 0);
    wdata : in  word_t;
    be    : in  std_logic_vector(3 downto 0);
    we    : in  std_logic;
    phase : in  std_logic_vector(1 downto 0) := "11";
    rdata : out word_t := (others => '0');
    rpar  : out std_logic := '0';
    rchk  : out chk_t := (others => '0');
    perr  : out std_logic := '0';
    due, corrected : out std_logic := '0');
end entity;

architecture rtl of nexus4_dmem is
  signal ram : word_array(0 to WORDS - 1) := memory_image(IMAGE, WORDS);
  signal par : std_logic_vector(0 to WORDS - 1) := parity_image(IMAGE, WORDS);
  signal chk : chk_array(0 to WORDS - 1) := chk_image(IMAGE, WORDS);
  signal sp : natural range 0 to WORDS - 1 := 0;
  signal sword : word_t := (others => '0');
  signal schk : chk_t := (others => '0');
begin
  process (clk)
    variable i : natural;
    variable keep : boolean;
    variable w : word_t;
  begin
    if rising_edge(clk) then
      perr <= '0'; due <= '0'; corrected <= '0';
      if ORBIT and rst = '0' then
        if phase = "00" then                          -- end of FETCH: read the next word to check
          sword <= ram(sp); schk <= chk(sp);
        elsif phase = "01" then                       -- end of DECODE: write it back if it needs it
          if ecc_state(sword, schk) = 1 then
            ram(sp) <= ecc_fix(sword, schk); chk(sp) <= ecc_check(ecc_fix(sword, schk)); corrected <= '1';
          elsif ecc_state(sword, schk) = 2 then
            due <= '1';
          end if;
          if sp = WORDS - 1 then sp <= 0; else sp <= sp + 1; end if;
        end if;
      end if;
      if addr >= DMEM_BASE and addr < DMEM_BASE + to_unsigned(4 * WORDS, 32) then
        i := to_integer(shift_right(addr - DMEM_BASE, 2));
        if we = '1' then
          w := ram(i);
          if parity(w) /= par(i) and be /= "1111" then perr <= '1'; end if;
          keep := false;
          if ORBIT and be /= "1111" then
            if ecc_state(w, chk(i)) = 2 then
              due <= '1';                              -- the word cannot be corrected: leave it as it is, so
              keep := true;                            -- that new check bits do not make it look good
            elsif ecc_state(w, chk(i)) = 1 then
              corrected <= '1';
            end if;
            w := ecc_fix(w, chk(i));                 -- merge into the corrected word
          end if;
          if be(0) = '1' then w(7 downto 0)   := wdata(7 downto 0);   end if;
          if be(1) = '1' then w(15 downto 8)  := wdata(15 downto 8);  end if;
          if be(2) = '1' then w(23 downto 16) := wdata(23 downto 16); end if;
          if be(3) = '1' then w(31 downto 24) := wdata(31 downto 24); end if;
          if not keep then
            ram(i) <= w;
            par(i) <= parity(w);
            chk(i) <= ecc_check(w);
          end if;
        end if;
        rdata <= ram(i);
        rpar <= par(i);
        rchk <= chk(i);
      end if;
    end if;
  end process;
end architecture;

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

-- The I/O page (D55): the sensor inputs, the trip latch with its causes, the watchdog, the profile.
-- Reads are registered, like the scratchpads', so an lw from it takes the same 4 cycles, and carry a
-- parity bit. Only whole words reach it (the core traps on anything else). The trip latch is kept in
-- three copies and the output is their OR: an upset of one copy can cause a trip, never clear one.
-- In ORBIT (fail-operational, D56) the watchdog does not trip: it asks for a restart (wdt_fire) and
-- starts counting again; STATUS reports the restarts and CORR the corrected errors.
entity nexus4_io is
  generic (PROFILE : natural; WDT_CYCLES : natural; SENSORS : word_array);
  port (
    clk, rst : in  std_logic;
    addr     : in  unsigned(31 downto 0);
    wdata    : in  word_t;
    we       : in  std_logic;
    hw_trip  : in  std_logic_vector(3 downto 0);   -- causes from outside the page (lockstep, parity)
    restarts : in  natural range 0 to 3 := 0;      -- ORBIT: how many restarts, and the last one's cause
    rcause   : in  natural range 0 to 3 := 0;
    corr     : in  natural := 0;                   -- ORBIT: single-bit errors corrected so far
    wdt_clear : in std_logic := '0';               -- ORBIT: a restart starts the watchdog again
    wdt_fire : out std_logic := '0';               -- ORBIT: the watchdog ran out
    rdata    : out word_t := (others => '0');
    rpar     : out std_logic := '0';
    rchk     : out chk_t := (others => '0');     -- ORBIT: check bits made with the word, like rpar
    trip     : out std_logic_vector(3 downto 0));
end entity;

architecture rtl of nexus4_io is
  signal causes_a, causes_b, causes_c : std_logic_vector(3 downto 0) := "0000";
  signal wdt    : natural := 0;                     -- cycles since the watchdog was last restarted
  signal causes : std_logic_vector(3 downto 0);
begin
  -- PLANT: the OR of the three copies (an upset can make a trip, never clear one). ORBIT, fail-operational:
  -- their majority, written back to all three at every edge, so an upset of one copy does neither
  causes <= (causes_a and causes_b) or (causes_a and causes_c) or (causes_b and causes_c) when PROFILE = PROFILE_ORBIT
            else causes_a or causes_b or causes_c;
  trip <= causes;
  process (clk)
    variable i : natural;
    variable set : std_logic_vector(3 downto 0);
    variable v : word_t;
  begin
    if rising_edge(clk) then
      if rst = '1' then
        causes_a <= "0000"; causes_b <= "0000"; causes_c <= "0000";
        wdt <= 0;
      else
        set := hw_trip;                               -- a trip stays until reset
        wdt_fire <= '0';
        if WDT_CYCLES > 0 then
          if wdt_clear = '1' then
            wdt <= 0;                                 -- ORBIT: a restart is under way; count again from it
          elsif wdt >= WDT_CYCLES - 1 then
            if PROFILE = PROFILE_ORBIT then wdt_fire <= '1'; wdt <= 0; else set(TRIP_WATCHDOG) := '1'; end if;
          else
            wdt <= wdt + 1;
          end if;
        end if;
        if addr >= IO_BASE and addr < IO_END then
          i := to_integer(shift_right(addr - IO_BASE, 2));
          if we = '1' then
            if i = IO_TRIP and wdata(0) = '1' then set(TRIP_PROGRAM) := '1'; end if;
            if i = IO_WDT and wdata = WDT_KEY then wdt <= 0; end if;
          end if;
          if i < 4 then
            v := SENSORS(i);
          elsif i = IO_TRIP then
            v := x"0000000" & causes;
          elsif i = IO_STATUS then
            v := std_logic_vector(to_unsigned(PROFILE + 256 * rcause + 65536 * restarts, 32));
          elsif i = IO_CORR then
            v := std_logic_vector(to_unsigned(corr, 32));
          else
            v := (others => '0');
          end if;
          rdata <= v;
          rpar <= parity(v);
          rchk <= ecc_check(v);
        end if;
        if PROFILE = PROFILE_ORBIT then
          causes_a <= causes or set; causes_b <= causes or set; causes_c <= causes or set;
        else
          causes_a <= causes_a or set;
          causes_b <= causes_b or set;
          causes_c <= causes_c or set;
        end if;
      end if;
    end if;
  end process;
end architecture;
