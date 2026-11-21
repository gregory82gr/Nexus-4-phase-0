#!/usr/bin/env node
// Checks the kernel's fault injection (kernel 0.4, D52) against GHDL.
//
// A deposit (a single-event upset: the value a driver holds is changed) is not a VHDL statement, so GHDL
// cannot run it directly. Each example in tests/faults has saboteurs compiled in only with the generic
// SAB = true: at the fault's time, the process that owns the upset element writes the upset value
// itself. GHDL runs the example with -gSAB=true; the kernel runs it with SAB = false and the faults of
// its "-- @fault:" lines. A saboteur's write lands one delta cycle after the kernel's deposit, so the
// two runs are compared at the end of every time step: the same time steps, and after the last delta
// cycle of each, the same value on every signal both have (the saboteur strobes aside).
//
// Two controls make sure the comparison can fail: the kernel run without the faults must differ from
// GHDL's, and so must a run with each fault one time step late (a fault must matter, and its time too).
//
//   @fault: flip <leaf> at <time> [bit <n>]
//   @fault: set <leaf> at <time> to <value>

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOracle, readMeta, formatTime } from './oracle.mjs';
import { loadKernel } from './kernel-runner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const DIR = join(ROOT, 'tests', 'faults');
const K = loadKernel(INDEX);

export function readFaults(source) {
  const out = [];
  for (const line of source.split(/\r?\n/)) {
    const m = /^--\s*@fault:\s*(flip|set)\s+(\S+)\s+at\s+(\S+)(?:\s+bit\s+(\d+))?(?:\s+to\s+(\S+))?\s*$/.exec(line);
    if (m) out.push({ kind: m[1], signal: m[2], at: m[3], bit: m[4] ? Number(m[4]) : 0, value: m[5] });
  }
  return out;
}

/** The value of every signal at the end of every time step: Map(time → { name: value }). */
function settled(snapshots, skip) {
  const out = new Map();
  for (const s of snapshots) {
    if (s.time === null || s.time === undefined) continue;
    const vals = {};
    for (const [n, v] of Object.entries(s.signals)) if (!skip(n)) vals[n] = v.val;
    out.set(s.time, vals);   // later deltas of the same time step overwrite earlier ones
  }
  return out;
}

function compare(a, b) {
  const times = new Set([...a.keys(), ...b.keys()]);
  for (const t of [...times].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))) {
    const x = a.get(t), y = b.get(t);
    if (!x || !y) return `time step ${formatTime(t)} only in ${x ? 'GHDL' : 'the kernel'}`;
    for (const n of Object.keys(x)) if (n in y && x[n] !== y[n]) return `${n} at the end of ${formatTime(t)}: GHDL ${x[n]}, kernel ${y[n]}`;
  }
  return null;
}

function main() {
  let checks = 0, failures = 0;
  const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
  const files = readdirSync(DIR).filter((f) => f.endsWith('.vhd')).sort();
  for (const f of files) {
    const file = join(DIR, f);
    const { meta, source } = readMeta(file);
    const faults = readFaults(source);
    const skip = (n) => /\.inj(\(|$)/.test(n);
    const ghdl = settled(runOracle(file, { generics: [['SAB', 'true']] }).snapshots, skip);
    const kernelRun = (fs) => settled(K.simulate({ source, top: meta.top, stop: meta.stop, faults: fs, log: false }).snapshots, skip);
    checks++;
    const d = compare(ghdl, kernelRun(faults));
    if (d) fail(`${f}: the kernel's deposits differ from GHDL's saboteurs: ${d}`);
    else console.log(`ok    ${f}: ${faults.length} faults, every time step settles as in GHDL`);
    checks++;
    if (!compare(ghdl, kernelRun([]))) fail(`${f}: control: without its faults the kernel still matches GHDL, so the faults change nothing`);
    for (let i = 0; i < faults.length; i++) {
      checks++;
      const late = faults.map((x, k) => (k === i ? { ...x, at: `${Number(x.at.replace(/ns$/, '')) + 1}ns` } : x));
      if (!compare(ghdl, kernelRun(late))) fail(`${f}: control: fault ${i + 1} one nanosecond late still matches, so its time is not checked`);
    }
  }
  console.log(`\n${checks} fault checks, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('fault-check.mjs')) main();
