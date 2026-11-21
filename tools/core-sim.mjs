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
  for (const id of ['nexus4-asm', 'nexus4-isa', 'nexus4-help']) {
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
/** The VHDL package nexus4_program for an assembled program: the words, and scratchpad sizes that hold them. */
export function programPackage(prog) {
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
    imem, dmem, text, data,
    vhdl: `-- Written by tools/core-check.mjs from an assembled program.
library ieee;
use ieee.std_logic_1164.all;
use work.nexus4_pkg.all;

package nexus4_program is
  constant PROGRAM_TEXT : word_array := ${agg(text)};
  constant PROGRAM_DATA : word_array := ${agg(data)};
  constant PROGRAM_IMEM_WORDS : positive := ${imem};
  constant PROGRAM_DMEM_WORDS : positive := ${dmem};
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
  return `C ${hex8(r.pc)} ${hex8(r.insn)} ${rd} ${rd ? hex8(r.wdata) : null} ${mem}`;
}
/**
 * The model's commits for a program, with the scratchpad sizes of its package. before(i, m), if given,
 * runs before instruction i (from 0), so a caller can change the machine there (an upset, say).
 */
export function modelRun(N4, prog, pkg, limit, before) {
  const m = new N4.isa.Machine({ imem: { size: 4 * pkg.imem }, dmem: { size: 4 * pkg.dmem } });
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

/** The testbench's report lines: commits ("C …", "T …") and the cycle count at HALT. */
export function parseReports(msgs) {
  const lines = [];
  let cycles = null;
  for (const t of msgs) {
    const h = /^HALT after (\d+) cycles$/.exec(t);
    if (h) { cycles = Number(h[1]); continue; }
    if (/^[CT] /.test(t)) {
      const f = t.split(' ');
      // the register value means nothing when no register is written
      if (f[0] === 'C' && f[3] === '0') f[4] = 'null';
      lines.push(f.join(' '));
    }
  }
  return { lines, cycles };
}

/** The core on the NEXUS-4 kernel: its commits and cycles (options: faults, snapshots, watch). */
export function coreOnKernel(kernel, source, stopNs, { snapshots = false, faults, watch } = {}) {
  const res = kernel.simulate({ source, top: 'tb_nexus4', stop: `${stopNs}ns`, snapshots, log: false, faults, watch });
  return { ...parseReports(res.reports.map((m) => m.text ?? m.message)), res };
}
