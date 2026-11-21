// Shared by tools/core-check.mjs and tools/fault-campaign.mjs: the NEXUS-4 scripts out of index.html,
// the program package for the VHDL core, the reference model's commits in the testbench's format, and
// the core on the NEXUS-4 kernel.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const read = (f) => readFileSync(f, 'utf8');
export const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0').toUpperCase();

/** The assembler, the ISA model and the Help, out of index.html. */
export function loadNexus(index) {
  const html = read(index);
  const sb = { console };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const id of ['nexus4-asm', 'nexus4-isa', 'nexus4-help', 'nexus4-faults']) {
    const open = `<script id="${id}">`;
    const a = html.indexOf(open);
    vm.runInContext(html.slice(a + open.length, html.indexOf('</script>', a)), sb, { filename: `${id}.js` });
  }
  return sb.NEXUS4;
}

/** The RTL files of the design, in compile order, with the testbench last. */
export function rtlFiles(rtlDir = join(ROOT, 'rtl')) {
  return [join(rtlDir, 'nexus4_pkg.vhd'), join(rtlDir, 'nexus4_core.vhd'), join(rtlDir, 'nexus4_soc.vhd'), join(ROOT, 'tests', 'core', 'tb_nexus4.vhd')];
}

const pow2 = (n) => { let p = 16; while (p < n) p *= 2; return p; };
const words = (bytes) => {
  const out = [];
  for (let i = 0; i < bytes.length; i += 4) out.push(((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0));
  return out;
};
/**
 * The VHDL package nexus4_program for an assembled program: the words, scratchpad sizes that hold them,
 * and (D55) the profile (0 BASE, 1 PLANT, 2 ORBIT), the watchdog's cycles (0: off) and the four sensor words.
 */
export function programPackage(prog, { profile = 0, wdt = 0, sensors = [0, 0, 0, 0] } = {}) {
  const text = words(prog.text), data = words(prog.data);
  const imem = pow2(text.length), dmem = pow2(data.length);
  const agg = (ws) => {
    if (!ws.length) ws = [0];
    if (ws.length === 1) return `(0 => x"${hex8(ws[0])}")`;
    const lines = [];
    for (let i = 0; i < ws.length; i += 6) lines.push('    ' + ws.slice(i, i + 6).map((w) => `x"${hex8(w)}"`).join(', '));
    return `(\n${lines.join(',\n')})`;
  };
  return {
    imem, dmem, text, data, profile, wdt, sensors,
    vhdl: `-- Written by tools/core-check.mjs from an assembled program.
library ieee;
use ieee.std_logic_1164.all;
use work.nexus4_pkg.all;

package nexus4_program is
  constant PROGRAM_TEXT : word_array := ${agg(text)};
  constant PROGRAM_DATA : word_array := ${agg(data)};
  constant PROGRAM_IMEM_WORDS : positive := ${imem};
  constant PROGRAM_DMEM_WORDS : positive := ${dmem};
  constant PROGRAM_PROFILE : natural := ${profile};
  constant PROGRAM_WDT_CYCLES : natural := ${wdt};
  constant PROGRAM_SENSORS : word_array(0 to 3) := (${sensors.map((w) => `x"${hex8(w)}"`).join(', ')});
end package;
`
  };
}
/** The whole design as one source: package, program, core, SoC, testbench. */
export const designSource = (files, pkg) => [read(files[0]), pkg.vhdl, read(files[1]), read(files[2]), read(files[3])].join('\n');

/** Cycles the core spends on one step of the model (D12: 3, 4 for a load; a fetch fault 1). */
export const CYCLES = (r) => (r.trap ? (r.insn === undefined ? 1 : 3) : r.mem && !r.mem.store ? 4 : 3);
/** A model commit record as the testbench reports it. */
export function commitLine(r) {
  if (r.trap) return `T ${hex8(r.pc)} ${hex8(r.insn ?? 0)} ${r.trap.cause} ${hex8(r.trap.tval)}`;
  const rd = r.rd ?? 0;
  const mem = r.mem ? (r.mem.store ? `S ${hex8(r.mem.addr)} ${hex8(r.mem.data)}` : `L ${hex8(r.mem.addr)} 00000000`) : 'N 00000000 00000000';
  // (a marker writes no register; the value it reports for the guardian stands in that place, D58)
  return `C ${hex8(r.pc)} ${hex8(r.insn)} ${rd} ${rd ? hex8(r.wdata) : r.mark ? hex8(r.mark.value) : null} ${mem}`;
}
/**
 * The model's commits for a program, with the scratchpad sizes of its package. before(i, m), if given,
 * runs before instruction i (from 0), so a caller can change the machine there (an upset, say).
 */
export function modelRun(N4, prog, pkg, limit, before) {
  const m = new N4.isa.Machine({ imem: { size: 4 * pkg.imem }, dmem: { size: 4 * pkg.dmem }, io: { sensors: pkg.sensors || [0, 0, 0, 0], profile: pkg.profile || 0 } });
  m.load(prog);
  const lines = [];
  let cycles = 1;   // the testbench counts one more cycle: halted rises one cycle after the trap commits
  for (let i = 0; i < limit; i++) {
    if (before) before(i, m);
    const r = m.step();
    cycles += CYCLES(r);
    lines.push(commitLine(r));
    if (r.trap) break;
  }
  return { lines, cycles, halted: !!m.halted, machine: m };
}

/**
 * ORBIT (D56): the model's commits when the system restarts the core. A trap other than ecall restarts
 * it, and so does the watchdog (pkg.wdt cycles, 0: off), which a store of the key to WDT starts again.
 * The run repeats, with the scratchpads and the I/O page as the last run left them, until ecall ends it
 * or three restarts have been made: the fourth stops the system.
 *
 * The timing, cycle for cycle as the testbench counts: the system sees a trap one cycle after it commits;
 * the watchdog runs out wdt + 1 cycles after it was started (the core's start, or the edge that ends
 * the store of the key); a restart at cycle R lets an instruction finish at R but not later, holds the
 * core in reset for one cycle and starts the watchdog again. When the same edge has both, the trap is
 * the cause. The fourth time the system stops: at once after a trap, two cycles later after the
 * watchdog (the core must still go to HALT).
 */
export function orbitModelRun(N4, prog, pkg, limit) {
  const m = new N4.isa.Machine({ imem: { size: 4 * pkg.imem }, dmem: { size: 4 * pkg.dmem }, io: { sensors: pkg.sensors || [0, 0, 0, 0], profile: 2 } });
  m.load(prog);
  const wdt = pkg.wdt || 0, KEY = 0x5AFEC0DE, WDT_ADDR = 0x20014;
  const lines = [], restarts = [];
  let c = 0, kick = 0;
  const due = () => (wdt ? kick + wdt + 1 : Infinity);
  for (let run = 0; ; run++) {
    let end = null;
    for (let i = 0; i < limit && !end; i++) {
      const R = due();
      // a store changes the scratchpad, so it is cut before it runs; anything else changes only the
      // registers and the pc, which are put back if it would finish too late
      const off = m.pc - m.map.imem.base;
      const store = m.pc % 4 === 0 && off >= 0 && off + 4 <= m.map.imem.size && (m.fetch(m.pc) & 0x7f) === 0x23;
      if (store && c + 3 > R) { end = { R, cause: 2 }; break; }
      const saved = { x: m.x.slice(), pc: m.pc, retired: m.retired, halted: m.halted };
      const r = m.step();
      if (c + CYCLES(r) > R) { m.x.set(saved.x); m.pc = saved.pc; m.retired = saved.retired; m.halted = saved.halted; end = { R, cause: 2 }; break; }
      c += CYCLES(r);
      lines.push(commitLine(r));
      if (r.mem && r.mem.store && r.mem.addr === WDT_ADDR && (r.mem.data >>> 0) === KEY) kick = c;
      if (r.trap) {
        if (r.trap.cause === 11) return { lines, cycles: c + 1, halted: true, restarts, machine: m };
        end = due() === c ? { R: c, cause: 2 } : { R: c + 1, cause: 3 };
      }
    }
    if (!end) return { lines, cycles: c, halted: false, restarts, machine: m };
    if (run === 3) return { lines, cycles: end.cause === 3 ? end.R : end.R + 2, halted: true, restarts, machine: m };
    restarts.push({ cause: end.cause, cycle: end.R });
    c = end.R + 1;
    kick = c;
    m.restart(end.cause);
  }
}

/** The testbench's report lines: commits ("C …", "T …"), the cycle count at HALT, trips and (ORBIT) restarts. */
export function parseReports(msgs) {
  const lines = [];
  const trips = [];
  const restarts = [];
  let cycles = null, corrections = 0;
  for (const t of msgs) {
    const cr = /^CORRECTED (\d+)$/.exec(t);
    if (cr) { corrections = Number(cr[1]); continue; }
    const rs = /^RESTART (\d) after (\d+) cycles$/.exec(t);
    if (rs) { restarts.push({ cause: Number(rs[1]), cycle: Number(rs[2]) }); continue; }
    const h = /^HALT after (\d+) cycles$/.exec(t);
    if (h) { cycles = Number(h[1]); continue; }
    const tr = /^TRIP ([0-9A-F]) after (\d+) cycles$/.exec(t);
    if (tr) { trips.push({ causes: parseInt(tr[1], 16), cycle: Number(tr[2]) }); continue; }
    if (/^[CT] /.test(t)) {
      const f = t.split(' ');
      // the register value means nothing when no register is written (but a marker's value does, D58)
      if (f[0] === 'C' && f[3] === '0' && (parseInt(f[2], 16) & 0x7f) !== 0x0b) f[4] = 'null';
      lines.push(f.join(' '));
    }
  }
  return { lines, cycles, trips, restarts, corrections };
}

/** The core on the NEXUS-4 kernel: its commits and cycles (options: faults, snapshots, watch). */
export function coreOnKernel(kernel, source, stopNs, { snapshots = false, faults, watch } = {}) {
  const res = kernel.simulate({ source, top: 'tb_nexus4', stop: `${stopNs}ns`, snapshots, log: false, faults, watch });
  return { ...parseReports(res.reports.map((m) => m.text ?? m.message)), res };
}
