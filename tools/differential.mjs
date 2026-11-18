// NEXUS-4 differential tests: every example runs through GHDL (the oracle) and
// through our kernel, and the two must agree delta cycle by delta cycle.
//
//   1. The GHDL version must match the calibrated one (the trace format is a debugging format).
//   2. Each example's own @expect lines are checked against GHDL. This proves the oracle
//      behaves as calibrated in this environment.
//   3. When the kernel is implemented, its snapshots and reports are compared with GHDL's.
//      Any difference fails the run.
//
// Usage: node tools/differential.mjs [example.vhd ...]   (default: all of tests/examples)

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REQUIRED_GHDL, checkExpectations, formatTime, ghdlVersion, readMeta, runOracle } from './oracle.mjs';
import { loadKernel, runKernel } from './kernel-runner.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const EXAMPLES = join(ROOT, 'tests', 'examples');

// Decision D31 (the observable projection). GHDL drops a transaction that does not change
// a signal's value when nothing can observe it ('active, 'transaction and 'last_active are
// outside the subset), so its trace omits cycles that contain only such transactions and
// never marks them active. The LRM keeps them, and so does our kernel's own log. Before
// comparing, our trace is projected the same way: a cycle with no event that resumed no
// process is dropped (in the subset such a cycle is always the last one at its time, so the
// delta numbering of the remaining cycles is unaffected), and the active flag is not compared.
function observable(snapshots) {
  return snapshots.filter((s) => s.time === null || s.resumed > 0 || Object.values(s.signals).some((x) => x.event));
}

function compareTraces(oracle, ours) {
  const diffs = [];
  const label = (s) => (s.time === null ? 'init' : `${formatTime(s.time)} +${s.delta}`);
  const kSnaps = observable(ours.snapshots);
  const n = Math.max(oracle.snapshots.length, kSnaps.length);
  for (let i = 0; i < n && diffs.length < 20; i++) {
    const g = oracle.snapshots[i];
    const k = kSnaps[i];
    if (!g || !k) {
      diffs.push(`cycle count differs: GHDL has ${oracle.snapshots.length}, kernel has ${kSnaps.length} (observable)`);
      break;
    }
    if (g.time !== k.time || g.delta !== k.delta) {
      diffs.push(`cycle ${i}: GHDL ${label(g)}, kernel ${label(k)}`);
      continue;
    }
    for (const [name, gs] of Object.entries(g.signals)) {
      const ks = k.signals[name];
      if (!ks) diffs.push(`${label(g)} ${name}: missing in kernel`);
      else if (ks.val !== gs.val || ks.event !== gs.event) {
        diffs.push(`${label(g)} ${name}: GHDL val=${gs.val} E=${gs.event}; kernel val=${ks.val} E=${ks.event}`);
      }
    }
    for (const name of Object.keys(k.signals)) {
      if (!(name in g.signals)) diffs.push(`${label(g)} ${name}: not in GHDL trace`);
    }
  }
  const gReports = oracle.reports.filter((r) => !r.file.includes('/ieee')).map((r) => `${formatTime(r.time)} ${r.kind} ${r.severity}: ${r.text}`);
  const kReports = (ours.reports ?? []).map((r) => `${formatTime(r.time)} ${r.kind} ${r.severity}: ${r.text}`);
  if (JSON.stringify(gReports) !== JSON.stringify(kReports)) {
    diffs.push(`reports differ:\n      GHDL:   ${JSON.stringify(gReports)}\n      kernel: ${JSON.stringify(kReports)}`);
  }
  return diffs;
}

function main() {
  const version = ghdlVersion();
  console.log(`Oracle: ${version}`);
  if (!REQUIRED_GHDL.test(version)) {
    console.error(`FAIL: the oracle is calibrated for GHDL 4.1.x; found "${version}".`);
    process.exit(1);
  }

  const kernel = loadKernel(join(ROOT, 'index.html'));
  console.log(`Kernel: ${kernel.implemented ? `v${kernel.version}` : `v${kernel.version} (not implemented yet: oracle checks only)`}\n`);

  const files = process.argv.length > 2
    ? process.argv.slice(2).map((f) => resolve(f))
    : readdirSync(EXAMPLES).filter((f) => f.endsWith('.vhd')).sort().map((f) => join(EXAMPLES, f));

  let failed = 0;
  for (const file of files) {
    const { meta, source } = readMeta(file);
    const oracle = runOracle(file);
    const problems = checkExpectations(meta, oracle).map((p) => `oracle: ${p}`);
    const ours = runKernel(kernel, meta, source);
    if (ours) problems.push(...compareTraces(oracle, ours).map((p) => `kernel: ${p}`));

    const cycles = oracle.snapshots.length - 1;
    const checks = meta.expect.length + meta.expectEvent.length + meta.expectNoCycle.length + meta.expectReport.length;
    const status = problems.length ? 'FAIL' : 'PASS';
    const kernelNote = ours ? 'kernel compared' : 'kernel skipped';
    console.log(`${status}  ${meta.name.padEnd(24)} ${String(cycles).padStart(4)} cycles, ${checks} oracle checks, ${kernelNote}`);
    for (const p of problems) console.log(`      ${p}`);
    if (problems.length) failed++;
  }

  console.log(`\n${files.length - failed} of ${files.length} examples passed.`);
  process.exit(failed ? 1 : 0);
}

main();
