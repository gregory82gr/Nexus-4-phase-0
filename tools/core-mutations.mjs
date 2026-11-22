// NEXUS-4 core mutation checks: the comparison with the reference model must catch a broken core.
//
// Each mutation below breaks rtl/nexus4_core.vhd (or, with file, another file of rtl/) in one specific way.
// tools/core-check.mjs runs against the broken copy (one random program of 800 statements, for speed; the
// riscv-tests too if RISCV_TESTS is set) and must fail. A PLANT safety mechanism that is switched off
// changes nothing without faults, so those mutations run the PLANT fault campaign instead, whose aimed
// upsets each mechanism must catch (tool: campaign). A mutation whose text is no longer found, or not
// unique, fails too. A mutation counts as caught only when a check fails (a FAIL line): a checker that
// crashes has caught nothing (D62: the first run of the net's mutations "caught" all six by a crash).
//
// Usage: [RISCV_TESTS=...] node tools/core-mutations.mjs

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FILE = 'nexus4_core.vhd';

export const MUTATIONS = [
  // the ALU
  { name: 'sra shifts in zeros', find: 'if f7(5) = \'1\' then y := unsigned(shift_right(signed(a), shamt)); else', replace: 'if false then y := unsigned(shift_right(signed(a), shamt)); else' },
  { name: 'sub adds', find: 'if opcode = "0110011" and f7(5) = \'1\' then y := unsigned(a) - op2;', replace: 'if false then y := unsigned(a) - op2;' },
  { name: 'slt compares unsigned', find: 'when "010" => if signed(a) < signed(op2) then', replace: 'when "010" => if unsigned(a) < op2 then' },
  { name: 'lui keeps the low bits', find: 'u_bits := ir(31 downto 12) & x"000";', replace: 'u_bits := x"000" & ir(31 downto 12);' },
  { name: 'auipc adds to the next pc', find: 'legal := true; writes_rd <= true; y := pc + unsigned(u_imm);', replace: 'legal := true; writes_rd <= true; y := pc + 4 + unsigned(u_imm);' },
  { name: 'S immediate halves swapped', find: 's_bits := ir(31 downto 25) & ir(11 downto 7);', replace: 's_bits := ir(11 downto 7) & ir(31 downto 25);' },
  // control flow
  { name: 'bge is strict', find: 'when "101" => taken := signed(a) >= signed(b);', replace: 'when "101" => taken := signed(a) > signed(b);' },
  { name: 'bltu compares signed', find: 'when "110" => taken := unsigned(a) < unsigned(b);', replace: 'when "110" => taken := signed(a) < signed(b);' },
  { name: 'jalr keeps bit 0', find: 'target := (unsigned(a) + unsigned(i_imm)) and x"FFFFFFFE";', replace: 'target := unsigned(a) + unsigned(i_imm);' },
  { name: 'jal links to its own address', find: 'legal := true; writes_rd <= true; y := pc + 4; taken := true;\n        target := pc + unsigned(j_imm);', replace: 'legal := true; writes_rd <= true; y := pc; taken := true;\n        target := pc + unsigned(j_imm);' },
  { name: 'B immediate without bit 11', find: "b_bits := ir(31) & ir(7) & ir(30 downto 25)", replace: "b_bits := ir(31) & '0' & ir(30 downto 25)" },
  // registers and memory
  { name: 'x0 can be written', find: 'if writes_rd and rd /= 0 then', replace: 'if writes_rd then' },
  { name: 'lb zero-extends', find: 'when "000" => loaded := std_logic_vector(resize(signed(lane_data(7 downto 0)), 32));', replace: 'when "000" => loaded := std_logic_vector(resize(unsigned(lane_data(7 downto 0)), 32));' },
  { name: 'lhu sign-extends', find: 'when "101" => loaded := std_logic_vector(resize(unsigned(lane_data(15 downto 0)), 32));', replace: 'when "101" => loaded := std_logic_vector(resize(signed(lane_data(15 downto 0)), 32));' },
  { name: 'byte 1 of a load read from byte 2', find: 'when "01"   => lane_data := x"00" & dw(31 downto 8);', replace: 'when "01"   => lane_data := x"0000" & dw(31 downto 16);' },
  { name: 'sb writes the wrong lane', find: 'when "01" => store_be <= "0010";', replace: 'when "01" => store_be <= "0100";' },
  { name: 'sh writes the upper half only from zeros', find: 'store_data <= b(15 downto 0) & b(15 downto 0);', replace: 'store_data <= x"0000" & b(15 downto 0);' },
  { name: 'the scratchpad ignores the byte lanes', find: "if be(1) = '1' then w(15 downto 8)", replace: "if true then w(15 downto 8)" },
  // traps
  { name: 'ecall reported as an illegal instruction', find: 'trap <= true; trap_cause <= CAUSE_ECALL;', replace: 'trap <= true; trap_cause <= CAUSE_ILLEGAL; trap_tval <= ir;' },
  { name: 'the last word of the instruction scratchpad cannot be fetched', find: 'if pc >= IMEM_END then', replace: 'if pc >= IMEM_END - 4 then' },
  { name: 'misaligned half-words allowed', find: "if (size = 2 and addr(0) /= '0') or", replace: "if false or" },
  { name: 'the last word of the data scratchpad is a fault', find: 'elsif addr < DMEM_BASE or addr > DMEM_END - size then', replace: 'elsif addr < DMEM_BASE or addr >= DMEM_END - size then' },
  { name: 'misaligned jump targets allowed', find: 'elsif taken and target(1 downto 0) /= "00" then', replace: 'elsif taken and target(0) /= \'0\' then' },
  { name: 'srai accepts any funct7', find: 'or (f3 = "101" and f7 = "0100000");', replace: 'or f3 = "101";' },
  { name: 'fetch past the scratchpad allowed', find: 'if pc >= IMEM_END then', replace: 'if false then' },
  // timing: the same results, one cycle more at every odd word address; only the cycle count can tell
  { name: 'a fetch at an odd word address waits a cycle', find: "            else\n              nstate := S_DECODE;\n            end if;", replace: "            elsif commit = '0' or pc(2) = '0' then\n              nstate := S_DECODE;\n            end if;" },
  { name: 'fence.i accepted as fence', find: 'legal := f3 = "000";', replace: 'legal := true;' },
  // PLANT and the I/O page (D55)
  { name: 'PLANT: the comparator never trips', file: 'nexus4_soc.vhd', tool: 'campaign', find: "if rst_d2 = '0' and stop = '0' and m_d2 /= s_out then lockstep_err <= '1'; end if;", replace: 'null;' },
  { name: 'PLANT: loaded words are not parity-checked', file: 'nexus4_soc.vhd', tool: 'campaign', find: "if read_ram = '1' and read_io = '0' and parity(ram_rdata) /= dmem_rpar then parity_err <= '1'; end if;", replace: 'null;' },
  { name: 'PLANT: instruction words are not parity-checked', file: 'nexus4_soc.vhd', tool: 'campaign', find: "if parity(imem_rdata) /= imem_rpar then parity_err <= '1'; end if;", replace: 'null;' },
  { name: 'PLANT: I/O reads are not parity-checked', file: 'nexus4_soc.vhd', tool: 'campaign', find: "if read_ram = '1' and read_io = '1' and parity(io_rdata) /= io_rpar then parity_err <= '1'; end if;", replace: 'null;' },
  { name: 'PLANT: one trip latch instead of three', tool: 'campaign', find: 'else causes_a or causes_b or causes_c;', replace: 'else causes_b;' },
  { name: 'PLANT: the shadow runs in step, not two cycles behind', file: 'nexus4_soc.vhd', find: 'clk => clk, rst => rst_d2, stop => stop,', replace: 'clk => clk, rst => rst, stop => stop,' },
  { name: 'the watchdog never trips', find: "wdt <= 0; else set(TRIP_WATCHDOG) := '1'; end if;", replace: "wdt <= 0; else null; end if;" },
  { name: 'the watchdog restarts on any value', find: "if i = IO_WDT and wdata = WDT_KEY then wdt <= 0; end if;", replace: "if i = IO_WDT then wdt <= 0; end if;" },
  { name: 'the I/O page takes bytes too', find: "if size /= 4 then                                -- the I/O page takes whole words only", replace: "if false then                                -- the I/O page takes whole words only" },
  // ORBIT (D56): a mechanism switched off changes nothing without faults, so most run the ORBIT fault
  // campaign, whose aimed upsets each one must handle (tool: orbit); a restart and the STATUS it leaves
  // happen without faults, so core-check sees those
  { name: 'ORBIT: operands are not corrected', tool: 'orbit', find: 'a     <= ecc_fix(a_r, a_c) when ORBIT else a_r;', replace: 'a     <= a_r;' },
  { name: 'ORBIT: the pc is not voted', tool: 'orbit', find: 'pc    <= (pc_r and pc_b) or (pc_r and pc_c) or (pc_b and pc_c) when ORBIT else pc_r;', replace: 'pc    <= pc_r;' },
  { name: 'ORBIT: the control state is not voted', tool: 'orbit', find: 'state <= vote(state_r, state_b, state_c) when ORBIT else state_r;', replace: 'state <= state_r;' },
  { name: 'ORBIT: instruction words are not corrected', tool: 'orbit', find: 'if ORBIT then iw := ecc_fix(imem_rdata, imem_rchk); else iw := imem_rdata; end if;', replace: 'iw := imem_rdata;' },
  { name: 'ORBIT: the data scrubber never writes back', tool: 'orbit', find: 'ram(sp) <= ecc_fix(sword, schk); chk(sp) <= ecc_check(ecc_fix(sword, schk)); corrected <= \'1\';', replace: 'null;' },
  { name: 'ORBIT: the register scrubber looks at nothing', tool: 'orbit', find: 'when S_FETCH  => see(0, regs(scrub_ptr), regs_chk(scrub_ptr));', replace: 'when S_FETCH  => null;' },
  { name: 'ORBIT: an uncorrectable error in the core does not restart it', tool: 'orbit', file: 'nexus4_soc.vhd', find: "and (c_due = '1' or i_due", replace: "and (false or i_due" },
  { name: 'ORBIT: a trap does not restart the core', file: 'nexus4_soc.vhd', find: "trapped := c_commit = '1' and c_trap = '1' and c_cause /= CAUSE_ECALL;", replace: 'trapped := false;' },
  { name: 'ORBIT: the watchdog trips instead of restarting', find: "if PROFILE = PROFILE_ORBIT then wdt_fire <= '1';", replace: "if false then wdt_fire <= '1';" },
  { name: 'ORBIT: STATUS does not count restarts', find: 'v := std_logic_vector(to_unsigned(PROFILE + 256 * rcause + 65536 * restarts, 32));', replace: 'v := std_logic_vector(to_unsigned(PROFILE + 256 * rcause, 32));' },
  { name: 'ORBIT: a byte store merges into the uncorrected word', tool: 'orbit', find: 'w := ecc_fix(w, chk(i));                 -- merge into the corrected word', replace: 'null;' },
  { name: 'ORBIT: a byte store re-encodes a word it cannot correct', tool: 'orbit', find: 'if not keep then', replace: 'if true then' },
  // the guardian's marker (D58)
  { name: 'the marker is illegal', find: 'legal := f3 = "000" and ir(11 downto 7) = "00000";', replace: 'legal := false;' },
  { name: 'the marker reports no value', find: 'elsif ir(6 downto 0) = "0001011" then         -- a marker: its value, for the guardian\n                commit_wdata <= alu_y;', replace: 'elsif false then\n                null;' },
  { name: 'ORBIT: no stop after three restarts', file: 'nexus4_soc.vhd', tool: 'orbit', find: "              st := '1';", replace: '              null;' },
  // the guardian (D59): each part of the engine, and how the profiles answer it (tests/guard)
  { name: 'guardian: a subtraction adds', find: '      elsif cf = "11" then s := s - resize(v(j), 40);\n', replace: '      elsif cf = "11" then s := s + resize(v(j), 40);\n' },
  { name: 'guardian: <= is strict', find: 'when 0 => return s <= k;', replace: 'when 0 => return s < k;' },
  { name: 'guardian: the data image is not checked', find: "stored := fresh = '1';", replace: 'stored := false;' },
  { name: 'guardian: invariants not checked after a store', find: 'nv(k) := signed(commit_mdata); stored := true;', replace: 'nv(k) := signed(commit_mdata);' },
  { name: 'guardian: a byte store is followed', find: 'stored := true; else c := 15; end if;', replace: 'stored := true; else nv(k) := signed(commit_mdata); end if;' },
  { name: 'guardian: an automaton never reaches its violation', find: 'if ns = 7 and c = 0 then c := 9 + n; end if;', replace: 'null;' },
  { name: 'guardian: a deadline one cycle late', find: 'elsif counts(k) + 1 > lim then', replace: 'elsif counts(k) > lim then' },
  { name: 'guardian: the stop event does not stop a deadline', find: "if e = CNT_STOP(k) then active(k) <= '0';", replace: 'if false then null;' },
  { name: 'guardian: a restart forgets the variables', find: "      elsif restart = '1' then\n        states <= init_states;", replace: "      elsif restart = '1' then\n        vals <= init_vals; states <= init_states;" },
  { name: 'guardian: a violation does not stop BASE or PLANT', file: 'nexus4_soc.vhd', find: ' or causes(TRIP_GUARDIAN);', replace: ';' },
  { name: 'guardian: ORBIT does not restart on a violation', file: 'nexus4_soc.vhd', find: " or trapped or guard_viol = '1') then", replace: ' or trapped) then' },
  { name: 'guardian: ORBIT gives the watchdog as the cause', file: 'nexus4_soc.vhd', find: "elsif guard_viol = '1' then cause := RESTART_GUARDIAN;", replace: 'elsif false then null;' },
  // the guardian's Petri net (D62)
  { name: 'net: a transition fires though not enabled', find: 'if not tokens_ok(e, tokens) then c := 16;', replace: 'if false then c := 16;' },
  { name: 'net: capacities not checked', find: 'if nt > CAP(i) and c = 0 then c := 17 + i; end if;', replace: 'null;' },
  { name: 'net: the final marking is not final', find: 'live := false; fin := HAS_FINAL; anyt := false;', replace: 'live := false; fin := false; anyt := false;' },
  { name: 'net: a dead marking is never reported', find: 'elsif dcount + 1 > DEAD_LIM then if c = 0 then c := 25; end if;', replace: 'elsif false then null;' },
  { name: 'net: an automaton\'s veto ignored for deadness', find: 'if n < N_AUT and next_state(n, states(n), t) = 7 then ok := false; end if;', replace: 'null;' },
  { name: 'net: a restart keeps the marking', find: "fresh <= '0'; tokens <= INIT_TOK; dcount <= 0;", replace: "fresh <= '0'; dcount <= 0;" },
  // idempotent regions (D63)
  { name: 'idem: a write after an exposed read allowed', find: 'if hit_e then c := 26;', replace: 'if false then c := 26;' },
  { name: 'idem: a read of a word the region wrote counted as exposed', find: 'elsif not hit_e and not hit_w then', replace: 'elsif not hit_e then' },
  { name: 'idem: reads beyond eight forgotten', find: 'if exp_n = 8 then c := 27; else exp_a(exp_n) <= wd; exp_n <= exp_n + 1; end if;', replace: 'if exp_n < 8 then exp_a(exp_n) <= wd; exp_n <= exp_n + 1; end if;' },
  { name: 'idem: a region never closes', find: "elsif IDEM_ON and e = IDEM_END then in_region <= '0';", replace: 'elsif IDEM_ON and e = IDEM_END then null;' },
  // Hoare contracts (D64)
  { name: 'contract: checks never fail', find: '              c := 28 + k;', replace: '              null;' },
  { name: 'contract: every ghost from the marker', find: "              if gw(4) = '1' then ghosts(i) <= nv(to_integer(unsigned(gw(7 downto 5))));", replace: "              if false then ghosts(i) <= nv(to_integer(unsigned(gw(7 downto 5))));" },
  { name: 'contract: the marker\'s value ignored', find: 'not check_holds(k, nv, ghosts, commit_wdata)', replace: 'not check_holds(k, nv, ghosts, (others => \'0\'))' },
];

function main() {
  const work = mkdtempSync(join(tmpdir(), 'nexus4-core-mutants-'));
  let survived = 0, stale = 0;
  try {
    // NEXUS4_ONLY=text runs only the mutations whose name contains it (for working on one)
    for (const m of MUTATIONS.filter((x) => !process.env.NEXUS4_ONLY || x.name.includes(process.env.NEXUS4_ONLY))) {
      const file = m.file || FILE;
      const original = readFileSync(join(ROOT, 'rtl', file), 'utf8');
      const at = original.indexOf(m.find);
      if (at < 0 || original.indexOf(m.find, at + 1) >= 0) {
        console.log(`STALE     ${m.name}: its text is ${at < 0 ? 'no longer in' : 'not unique in'} rtl/${file}`);
        stale++;
        continue;
      }
      cpSync(join(ROOT, 'rtl'), work, { recursive: true });
      writeFileSync(join(work, file), original.replace(m.find, m.replace));
      const run = m.tool === 'campaign' || m.tool === 'orbit'
        ? spawnSync(process.execPath, [join(ROOT, 'tools', 'fault-campaign.mjs'), m.tool === 'orbit' ? '--orbit' : '--plant'],
          { env: { ...process.env, NEXUS4_RTL: work, NEXUS4_PER: '3' }, encoding: 'utf8', maxBuffer: 1 << 26 })
        : spawnSync(process.execPath, [join(ROOT, 'tools', 'core-check.mjs')],
          { env: { ...process.env, NEXUS4_RTL: work, NEXUS4_SEED: '4004', NEXUS4_FUZZ: '800', NEXUS4_FAILFAST: '1', NODE_OPTIONS: '--max-old-space-size=6144' }, encoding: 'utf8', maxBuffer: 1 << 26 });
      // caught means a check failed (a FAIL line); a checker that crashed has not caught anything
      const failLine = run.stdout.split('\n').find((l) => l.startsWith('FAIL'));
      const caught = run.status !== 0 && !!failLine;
      const broke = run.status !== 0 && !failLine;
      const first = (failLine || run.stderr.split('\n').find((l) => /Error|error/.test(l)) || run.stderr.split('\n')[0] || '').replace(/^FAIL\s+/, '');
      console.log(`${caught ? 'CAUGHT   ' : broke ? 'BROKE    ' : 'SURVIVED '} ${m.name}${caught || broke ? `  (${first.slice(0, 90)})` : ''}`);
      if (!caught) survived++;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${MUTATIONS.length - survived - stale} of ${MUTATIONS.length} core mutations caught.`);
  process.exit(survived || stale ? 1 : 0);
}

main();
