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
      when "0001011" =>                                   -- nx.mark (custom-0, D58): an event for the guardian;
        legal := f3 = "000" and ir(11 downto 7) = "00000"; -- it changes nothing, and reports rs1 on the commit port
        y := unsigned(a);
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
              elsif ir(6 downto 0) = "0001011" then         -- a marker: its value, for the guardian
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
    hw_trip  : in  trip_t;                         -- causes from outside the page (lockstep, parity, guardian)
    restarts : in  natural range 0 to 3 := 0;      -- ORBIT: how many restarts, and the last one's cause
    rcause   : in  natural range 0 to 4 := 0;
    corr     : in  natural := 0;                   -- ORBIT: single-bit errors corrected so far
    wdt_clear : in std_logic := '0';               -- ORBIT: a restart starts the watchdog again
    wdt_fire : out std_logic := '0';               -- ORBIT: the watchdog ran out
    rdata    : out word_t := (others => '0');
    rpar     : out std_logic := '0';
    rchk     : out chk_t := (others => '0');     -- ORBIT: check bits made with the word, like rpar
    trip     : out trip_t);
end entity;

architecture rtl of nexus4_io is
  signal causes_a, causes_b, causes_c : trip_t := (others => '0');
  signal wdt    : natural := 0;                     -- cycles since the watchdog was last restarted
  signal causes : trip_t;
begin
  -- PLANT: the OR of the three copies (an upset can make a trip, never clear one). ORBIT, fail-operational:
  -- their majority, written back to all three at every edge, so an upset of one copy does neither
  causes <= (causes_a and causes_b) or (causes_a and causes_c) or (causes_b and causes_c) when PROFILE = PROFILE_ORBIT
            else causes_a or causes_b or causes_c;
  trip <= causes;
  process (clk)
    variable i : natural;
    variable set : trip_t;
    variable v : word_t;
  begin
    if rising_edge(clk) then
      if rst = '1' then
        causes_a <= (others => '0'); causes_b <= (others => '0'); causes_c <= (others => '0');
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
            v := (others => '0');
            v(4 downto 0) := causes;
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

-- ======================================================================================================
-- The guardian (D58, D59): one fixed engine, configured by a table (PROGRAM_GUARD, 79 words, written by
-- NEXUS4.guard.build in the page). It watches the commit port and nothing else, and is built only from
-- what D18 allows: linear comparisons with coefficients −1, 0, +1, small automata and counters.
--   words 1–8    the mapped variables' byte addresses (D21: each variable is a word of the data scratchpad)
--   words 9–24   invariants: coefficients (2 bits per variable: 01 = +1, 11 = −1) and the comparison (bits
--                16–18: <=, <, =, /=, >=, >), then the constant
--   words 25–40  the marker numbers of the events
--   words 41–74  two automata: the initial state, then for each of 8 states the next state on each of 16
--                events (3 bits each); state 7 is the violation
--   words 75–78  deadlines: the start event, the stop event, the limit in cycles
--   words 79–99  the Petri net (D62): places, deadlock limit, a final marking; first tokens, capacities;
--                each event's arcs (pre in bits 0–15, post in bits 16–31, 2 bits per place)
--   words 100–127  Hoare contracts (D64): four ghosts and eight checks
--   word 0       how many of each, bit 31 when the guardian is on, and idempotent regions (D63): bit 18
--                on, bits 19–22 the event that opens a region, bits 23–26 the event that closes it
-- The variables change only when the program stores to them, so the invariants are checked in the first
-- cycle (on the data image) and after each store to a mapped variable. The automata step on markers; a
-- deadline's counter counts every cycle from its start event until its stop event.
-- The first violation is kept (code: 1–8 an invariant, 9–10 an automaton, 11–14 a deadline, 15 a byte
-- or half-word store to a mapped variable; with a Petri net, D62: 16 a transition not enabled, 17–24 a place
-- over its capacity, 25 a dead marking for too long; with idempotent regions, D63: 26 a write to a word the
-- region read first, 27 a region too large to check; with contracts, D64: 28–35 a contract's check) until reset, or until ORBIT restarts the core (D59):
-- then the automata and the deadlines start again, but the variables keep their values, as the data
-- scratchpad keeps its contents, and the invariants are next checked at the next store to a mapped
-- variable (the restarted program's chance to repair what it broke). tools/core-check.mjs compares the
-- engine, commit by commit and cycle by cycle, with the reference model NEXUS4.guard.Guardian.
-- ======================================================================================================
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
use work.nexus4_pkg.all;

entity nexus4_guard is
  generic (G : word_array; DATA : word_array);
  port (
    clk, rst     : in  std_logic;
    restart      : in  std_logic;                  -- ORBIT restarts the core
    commit       : in  std_logic;
    commit_insn  : in  word_t;
    commit_wdata : in  word_t;                     -- a marker's value (the register it carries, D64)
    commit_mem   : in  std_logic_vector(1 downto 0);
    commit_maddr : in  word_t;
    commit_mdata : in  word_t;
    viol         : out std_logic := '0';
    code         : out natural range 0 to 63 := 0);
end entity;

architecture rtl of nexus4_guard is
  function at(i : natural) return word_t is
  begin
    if i <= G'high then return G(i); else return (others => '0'); end if;
  end function;
  constant HDR : word_t := at(0);
  constant ENABLED : boolean := HDR(31) = '1';
  constant N_VARS : natural := to_integer(unsigned(HDR(3 downto 0)));
  constant N_INV : natural := to_integer(unsigned(HDR(7 downto 4)));
  constant N_EV : natural := to_integer(unsigned(HDR(12 downto 8)));
  constant N_AUT : natural := to_integer(unsigned(HDR(14 downto 13)));
  constant N_CNT : natural := to_integer(unsigned(HDR(17 downto 15)));
  type vals_t is array (0 to 7) of signed(31 downto 0);
  type states_t is array (0 to 1) of natural range 0 to 7;
  type counts_t is array (0 to 3) of natural;
  -- the table's fields, read once: the variables' word addresses, the events' marker numbers, the deadlines
  type nats16_t is array (0 to 15) of natural;
  function field(first, count, hi, lo : natural) return nats16_t is
    variable r : nats16_t := (others => 0);
    variable w : word_t;
  begin
    for k in 0 to 15 loop
      if k < count then
        w := at(first + k);
        r(k) := to_integer(unsigned(w(hi downto lo)));
      end if;
    end loop;
    return r;
  end function;
  constant VAR_WORD : nats16_t := field(1, N_VARS, 17, 2);     -- (the scratchpads are 64 KiB: bits 17–2 suffice)
  constant EVENT_ID : nats16_t := field(25, N_EV, 11, 0);
  constant CNT_START : nats16_t := field(75, N_CNT, 4, 0);
  constant CNT_STOP : nats16_t := field(75, N_CNT, 9, 5);
  constant CNT_LIMIT : nats16_t := field(75, N_CNT, 31, 10);
  -- the Petri net (D19, D62): words 79–99. Up to 8 places of 0..15 tokens; each event's arcs, weights 0..3
  constant NET_HDR : word_t := at(79);
  constant N_PL : natural := to_integer(unsigned(NET_HDR(3 downto 0)));
  constant HAS_FINAL : boolean := NET_HDR(4) = '1';
  constant DEAD_LIM : natural := to_integer(unsigned(NET_HDR(31 downto 8)));
  type tok_t is array (0 to 7) of natural range 0 to 15;
  type arcrow_t is array (0 to 7) of natural range 0 to 3;
  type arcs_t is array (0 to 15) of arcrow_t;            -- (an array of arrays: the subset has no 2-D arrays)
  function nibbles(w : word_t) return tok_t is
    variable r : tok_t := (others => 0);
  begin
    for i in 0 to 7 loop r(i) := to_integer(unsigned(w(4 * i + 3 downto 4 * i))); end loop;
    return r;
  end function;
  function arcs(shift : natural) return arcs_t is
    variable r : arcs_t := (others => (others => 0));
    variable w : word_t;
  begin
    for e in 0 to 15 loop
      w := at(84 + e);
      for i in 0 to 7 loop r(e)(i) := to_integer(unsigned(w(shift + 2 * i + 1 downto shift + 2 * i))); end loop;
    end loop;
    return r;
  end function;
  -- idempotent regions (D63): header bit 18, and the events that open (bits 19–22) and close (23–26) a region
  constant IDEM_ON : boolean := HDR(18) = '1';
  constant IDEM_BEGIN : natural := to_integer(unsigned(HDR(22 downto 19)));
  constant IDEM_END : natural := to_integer(unsigned(HDR(26 downto 23)));
  type words8_t is array (0 to 7) of natural range 0 to 16383;   -- word indexes in the data scratchpad
  -- Hoare contracts (D64): words 100–103 four ghosts (bit 31 on; the event in bits 0–3; bit 4 from a mapped
  -- variable, whose index is in bits 5–7, else from the marker's value); words 104–127 eight checks of three
  -- words (coefficients: 2 bits per variable, then per ghost from bit 16, the marker's value in bits 24–25,
  -- the comparison in bits 26–28; then bit 31 on and the event in bits 0–3; then the constant)
  type ghosts_t is array (0 to 3) of signed(31 downto 0);
  function ghost_word(i : natural) return word_t is begin return at(100 + i); end function;
  function check_word(k, j : natural) return word_t is begin return at(104 + 3 * k + j); end function;
  -- a contract check: the sum of ±variables, ±ghosts and ±the marker's value, compared with the constant
  function check_holds(k : natural; v : vals_t; gh : ghosts_t; m : word_t) return boolean is
    variable w : word_t := check_word(k, 0);
    variable s, kk : signed(39 downto 0);
    variable cf : std_logic_vector(1 downto 0);
  begin
    s := (others => '0');
    for j in 0 to 7 loop
      cf := w(2 * j + 1 downto 2 * j);
      if cf = "01" then s := s + resize(v(j), 40); elsif cf = "11" then s := s - resize(v(j), 40); end if;
    end loop;
    for j in 0 to 3 loop
      cf := w(16 + 2 * j + 1 downto 16 + 2 * j);
      if cf = "01" then s := s + resize(gh(j), 40); elsif cf = "11" then s := s - resize(gh(j), 40); end if;
    end loop;
    cf := w(25 downto 24);
    if cf = "01" then s := s + resize(signed(m), 40); elsif cf = "11" then s := s - resize(signed(m), 40); end if;
    kk := resize(signed(check_word(k, 2)), 40);
    case to_integer(unsigned(w(28 downto 26))) is
      when 0 => return s <= kk;
      when 1 => return s < kk;
      when 2 => return s = kk;
      when 3 => return s /= kk;
      when 4 => return s >= kk;
      when others => return s > kk;
    end case;
  end function;
  constant INIT_TOK : tok_t := nibbles(at(80));
  constant CAP : tok_t := nibbles(at(81));
  constant FIN_VAL : tok_t := nibbles(at(82));
  constant FIN_MASK : word_t := at(83);
  constant PRE : arcs_t := arcs(0);
  constant POST : arcs_t := arcs(16);
  function is_trans(e : natural) return boolean is
  begin
    for i in 0 to 7 loop
      if i < N_PL and (PRE(e)(i) /= 0 or POST(e)(i) /= 0) then return true; end if;
    end loop;
    return false;
  end function;
  function tokens_ok(e : natural; t : tok_t) return boolean is   -- each place holds the transition's pre tokens
  begin
    for i in 0 to 7 loop
      if i < N_PL and t(i) < PRE(e)(i) then return false; end if;
    end loop;
    return true;
  end function;
  function init_vals return vals_t is
    variable v : vals_t := (others => (others => '0'));
    variable i : integer;
  begin
    for k in 0 to 7 loop
      if k < N_VARS then
        i := VAR_WORD(k) - 16#4000#;                   -- (DMEM_BASE is word 16#4000#)
        if i >= 0 and i <= DATA'high then v(k) := signed(DATA(i)); end if;
      end if;
    end loop;
    return v;
  end function;
  function init_states return states_t is
    variable s : states_t := (0, 0);
    variable w : word_t;
  begin
    for n in 0 to 1 loop
      w := at(41 + 17 * n);
      if n < N_AUT then s(n) := to_integer(unsigned(w(2 downto 0))); end if;
    end loop;
    return s;
  end function;
  -- an invariant on the variables: the sum of ±variables compared with the constant (40 bits: no overflow)
  function holds(i : natural; v : vals_t) return boolean is
    variable w : word_t := at(9 + 2 * i);
    variable s, k : signed(39 downto 0);
    variable cf : std_logic_vector(1 downto 0);
  begin
    s := (others => '0');
    for j in 0 to 7 loop
      cf := w(2 * j + 1 downto 2 * j);
      if cf = "01" then s := s + resize(v(j), 40);
      elsif cf = "11" then s := s - resize(v(j), 40);
      end if;
    end loop;
    k := resize(signed(at(10 + 2 * i)), 40);
    case to_integer(unsigned(w(18 downto 16))) is
      when 0 => return s <= k;
      when 1 => return s < k;
      when 2 => return s = k;
      when 3 => return s /= k;
      when 4 => return s >= k;
      when others => return s > k;
    end case;
  end function;
  function next_state(n, st, e : natural) return natural is
    variable w : word_t := at(41 + 17 * n + 1 + 2 * st + e / 8);
    variable f : natural := 3 * (e mod 8);
  begin
    return to_integer(unsigned(w(f + 2 downto f)));
  end function;

  signal vals : vals_t := init_vals;
  signal states : states_t := init_states;
  signal active : std_logic_vector(0 to 3) := (others => '0');
  signal counts : counts_t := (others => 0);
  signal viol_q : std_logic := '0';
  signal fresh : std_logic := '1';                 -- the first cycle: check the data image
  signal tokens : tok_t := INIT_TOK;               -- the net's marking
  signal dcount : natural := 0;                    -- cycles the marking has been dead
  signal in_region : std_logic := '0';             -- inside an idempotent region
  signal exp_a, wr_a : words8_t := (others => 0);  -- its exposed reads and its writes
  signal exp_n, wr_n : natural range 0 to 8 := 0;
  signal ghosts : ghosts_t := (others => (others => '0'));   -- the contracts' ghost variables (D64)
begin
  viol <= viol_q;
  process (clk)
    variable nv : vals_t;
    variable c, e, ns : natural;
    variable addr : unsigned(31 downto 0);
    variable lim : natural;
    variable stored : boolean;
    variable nt : integer;
    variable dead, fin, live, anyt, ok : boolean;
    variable wd : natural range 0 to 16383;
    variable hit_e, hit_w : boolean;
    variable gw, cw : word_t;
  begin
    if rising_edge(clk) then
      if rst = '1' then
        vals <= init_vals; states <= init_states; active <= (others => '0'); counts <= (others => 0);
        viol_q <= '0'; code <= 0; fresh <= '1'; tokens <= INIT_TOK; dcount <= 0;
        in_region <= '0'; exp_n <= 0; wr_n <= 0; ghosts <= (others => (others => '0'));
      elsif restart = '1' then
        states <= init_states; active <= (others => '0'); counts <= (others => 0);
        viol_q <= '0'; code <= 0; fresh <= '0'; tokens <= INIT_TOK; dcount <= 0;
        in_region <= '0'; exp_n <= 0; wr_n <= 0; ghosts <= (others => (others => '0'));
      elsif ENABLED and viol_q = '0' then
        nv := vals; c := 0; e := 16; stored := fresh = '1';
        fresh <= '0';
        if commit = '1' then
          -- a store to a mapped variable: the guardian's copy follows it (only whole words)
          if commit_mem = MEM_STORE then
            for k in 0 to 7 loop
              if k < N_VARS and commit_maddr(31 downto 18) = "00000000000000" and to_integer(unsigned(commit_maddr(17 downto 2))) = VAR_WORD(k) then
                if commit_insn(13 downto 12) = "10" then nv(k) := signed(commit_mdata); stored := true; else c := 15; end if;
              end if;
            end loop;
          end if;
          -- a marker: which event it is
          if commit_insn(6 downto 0) = "0001011" then
            for k in 15 downto 0 loop
              if k < N_EV and to_integer(unsigned(commit_insn(31 downto 20))) = EVENT_ID(k) then e := k; end if;
            end loop;
          end if;
        end if;
        -- the invariants, on the variables after this store
        if c = 0 and stored then
          for i in 7 downto 0 loop
            if i < N_INV and not holds(i, nv) then c := 1 + i; end if;
          end loop;
        end if;
        -- the automata
        if c = 0 and e < 16 then
          for n in 0 to 1 loop
            if n < N_AUT then
              ns := next_state(n, states(n), e);
              states(n) <= ns;
              if ns = 7 and c = 0 then c := 9 + n; end if;
            end if;
          end loop;
        end if;
        -- the net: a transition must be enabled, then it fires; no place may go over its capacity
        if c = 0 and e < 16 and N_PL > 0 then
          if is_trans(e) then
            if not tokens_ok(e, tokens) then c := 16;
            else
              for i in 0 to 7 loop
                if i < N_PL then
                  nt := tokens(i) - PRE(e)(i) + POST(e)(i);
                  if nt > CAP(i) and c = 0 then c := 17 + i; end if;
                  if nt > 15 then nt := 15; end if;
                  tokens(i) <= nt;
                end if;
              end loop;
            end if;
          end if;
        end if;
        -- Hoare contracts (D64): the event's checks, with the ghosts as they were and the marker's value;
        -- then the ghosts the event sets
        if e < 16 then
          for k in 0 to 7 loop
            cw := check_word(k, 1);
            if c = 0 and cw(31) = '1' and to_integer(unsigned(cw(3 downto 0))) = e and not check_holds(k, nv, ghosts, commit_wdata) then
              c := 28 + k;
            end if;
          end loop;
          for i in 0 to 3 loop
            gw := ghost_word(i);
            if gw(31) = '1' and to_integer(unsigned(gw(3 downto 0))) = e then
              if gw(4) = '1' then ghosts(i) <= nv(to_integer(unsigned(gw(7 downto 5))));
              else ghosts(i) <= signed(commit_wdata);
              end if;
            end if;
          end loop;
        end if;
        -- idempotent regions (D63): no write to a word the region read before writing it (an exposed read)
        if IDEM_ON and c = 0 and in_region = '1' and commit = '1' and commit_maddr(31 downto 16) = x"0001"
           and (commit_mem = MEM_LOAD or commit_mem = MEM_STORE) then
          wd := to_integer(unsigned(commit_maddr(15 downto 2)));
          hit_e := false; hit_w := false;
          for k in 0 to 7 loop
            if k < exp_n and exp_a(k) = wd then hit_e := true; end if;
            if k < wr_n and wr_a(k) = wd then hit_w := true; end if;
          end loop;
          if commit_mem = MEM_STORE then
            if hit_e then c := 26;                          -- a clobber antidependence
            elsif not hit_w then
              if wr_n = 8 then c := 27; else wr_a(wr_n) <= wd; wr_n <= wr_n + 1; end if;
            end if;
          elsif not hit_e and not hit_w then                -- an exposed read
            if exp_n = 8 then c := 27; else exp_a(exp_n) <= wd; exp_n <= exp_n + 1; end if;
          end if;
        end if;
        if IDEM_ON and e = IDEM_BEGIN then in_region <= '1'; exp_n <= 0; wr_n <= 0;
        elsif IDEM_ON and e = IDEM_END then in_region <= '0'; exp_n <= 0; wr_n <= 0;
        end if;
        -- the deadlines: a counter runs from its start event; its stop event must come within the limit
        for k in 0 to 3 loop
          if k < N_CNT then
            lim := CNT_LIMIT(k);
            if active(k) = '1' then
              if e = CNT_STOP(k) then active(k) <= '0';
              elsif counts(k) + 1 > lim then if c = 0 then c := 11 + k; end if;
              else counts(k) <= counts(k) + 1;
              end if;
            elsif e = CNT_START(k) then
              active(k) <= '1'; counts(k) <= 0;
            end if;
          end if;
        end loop;
        -- a dead marking: no transition enabled (by its tokens and by the automata) and not the final one.
        -- Its count starts at the edge after the marking became dead (or after reset), like a deadline's
        if N_PL > 0 and DEAD_LIM > 0 then
          live := false; fin := HAS_FINAL; anyt := false;
          for i in 0 to 7 loop
            if i < N_PL and FIN_MASK(i) = '1' and tokens(i) /= FIN_VAL(i) then fin := false; end if;
          end loop;
          for t in 0 to 15 loop
            if t < N_EV and is_trans(t) then
              anyt := true;
              ok := tokens_ok(t, tokens);
              for n in 0 to 1 loop
                if n < N_AUT and next_state(n, states(n), t) = 7 then ok := false; end if;
              end loop;
              if ok then live := true; end if;
            end if;
          end loop;
          dead := anyt and not live and not fin;
          if fresh = '1' or not dead then dcount <= 0;
          elsif dcount + 1 > DEAD_LIM then if c = 0 then c := 25; end if;
          else dcount <= dcount + 1;
          end if;
        end if;
        vals <= nv;
        if c /= 0 then viol_q <= '1'; code <= c; end if;
      end if;
    end if;
  end process;
end architecture;

