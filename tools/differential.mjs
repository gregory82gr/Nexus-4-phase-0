// NEXUS-4 differential tests: every example runs through GHDL (the oracle) and
// through our kernel, and the two must agree delta cycle by delta cycle.
//
//   1. The GHDL version must match the calibrated one (the trace format is a debugging format).
//   2. Each example's own @expect lines are checked against GHDL. This proves the oracle
//      behaves as calibrated in this environment.
//   3. When the kernel is implemented, its snapshots and reports are compared with GHDL's.
//      Any difference fails the run. The kernel grows construct by construct: when an example
//      uses something it does not support yet, it throws an error with code NEXUS4_UNSUPPORTED
//      and the example is reported as PENDING. An example whose header says
//      "-- @kernel: required" must be fully supported: PENDING is a failure for it. Once an
//      example passes, mark it required so it can never silently fall back to pending.
//
// Usage: node tools/differential.mjs [example.vhd ...]   (default: all of tests/examples)

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REQUIRED_GHDL, checkExpectations, formatTime, ghdlVersion, readMeta, runOracle } from './oracle.mjs';
import { loadKernel, runKernel } from './kernel-runner.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const EXAMPLES = join(ROOT, 'tests', 'examples');

// Decision D31 (the observable projection, calibrated on GHDL 4.1). GHDL creates no transaction
// for an inertial assignment with a single zero-delay element whose value equals the driver's
// current value while the driver has nothing pending. Such a transaction cannot be observed in
// the subset ('active, 'transaction and 'last_active are outside it), so this is an as-if
// optimisation. The LRM keeps it, and so does our kernel, which tags it. Before comparing:
//   - a kernel cycle is dropped when it is not `observable`: no event, no resumed process and no
//     transaction other than tagged ones (in the subset such a cycle is always the last one at its
//     time, so the delta numbering of the remaining cycles is unaffected);
//   - the active flag is compared without the tagged transactions (`elidedOnly`).
// GHDL prints a cycle's signals after the cycle has run. When an assertion of severity failure
// ends the run inside a cycle, GHDL prints that cycle's header but not its signals; only the
// header is compared then.
function observable(snapshots) {
  return snapshots.filter((s) => s.time === null || s.observable);
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
    const headerOnly = i === oracle.snapshots.length - 1 && oracle.exitStatus !== 0 && Object.keys(g.signals).length === 0;
    if (headerOnly) continue;
    for (const [name, gs] of Object.entries(g.signals)) {
      const ks = k.signals[name];
      if (!ks) { diffs.push(`${label(g)} ${name}: missing in kernel`); continue; }
      const kActive = ks.active && !ks.elidedOnly;
      if (ks.val !== gs.val || ks.event !== gs.event || kActive !== gs.active) {
        diffs.push(`${label(g)} ${name}: GHDL val=${gs.val} A=${gs.active} E=${gs.event}; kernel val=${ks.val} A=${kActive} E=${ks.event}`);
      }
    }
    for (const name of Object.keys(k.signals)) {
      if (!(name in g.signals)) diffs.push(`${label(g)} ${name}: not in GHDL trace`);
    }
  }
  // Messages, including the warnings of the ieee library (numeric_std metavalues and the like), are compared
  // as a multiset per time: the LRM does not fix the order in which processes run within a delta cycle.
  const key = (r) => `${String(r.time).padStart(24, '0')} ${r.kind} ${r.severity}: ${r.text}`;
  const show = (k) => k.replace(/^0*(\d)/, '$1');
  const gReports = oracle.reports.map(key).sort();
  const kReports = (ours.reports ?? []).map(key).sort();
  if (JSON.stringify(gReports) !== JSON.stringify(kReports)) {
    const onlyG = gReports.filter((r) => !kReports.includes(r)).slice(0, 5).map(show);
    const onlyK = kReports.filter((r) => !gReports.includes(r)).slice(0, 5).map(show);
    diffs.push(`messages differ (GHDL ${gReports.length}, kernel ${kReports.length}):\n      only in GHDL:   ${JSON.stringify(onlyG)}\n      only in kernel: ${JSON.stringify(onlyK)}`);
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

  // NEXUS4_INDEX lets tools/mutations.mjs point the tests at a deliberately broken copy.
  const kernel = loadKernel(process.env.NEXUS4_INDEX || join(ROOT, 'index.html'));
  console.log(`Kernel: ${kernel.implemented ? `v${kernel.version}` : `v${kernel.version} (not implemented yet: oracle checks only)`}\n`);

  const files = process.argv.length > 2
    ? process.argv.slice(2).map((f) => resolve(f))
    : readdirSync(EXAMPLES).filter((f) => f.endsWith('.vhd')).sort().map((f) => join(EXAMPLES, f));

  let failed = 0;
  let compared = 0;
  let pending = 0;
  for (const file of files) {
    const { meta, source } = readMeta(file);
    const oracle = runOracle(file);
    const problems = checkExpectations(meta, oracle).map((p) => `oracle: ${p}`);
    let ours = null;
    let kernelNote = 'kernel skipped';
    let pendingReason = null;
    try {
      ours = runKernel(kernel, meta, source);
    } catch (err) {
      if (err && err.code === 'NEXUS4_UNSUPPORTED') {
        pendingReason = err.message;
        if (meta.kernelRequired) problems.push(`kernel: required, but ${err.message}`);
      } else {
        problems.push(`kernel: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
      }
    }
    if (ours) {
      problems.push(...compareTraces(oracle, ours).map((p) => `kernel: ${p}`));
      kernelNote = 'kernel compared';
      compared++;
    } else if (pendingReason) {
      kernelNote = 'kernel pending';
    }

    const cycles = oracle.snapshots.length - 1;
    const checks = meta.expect.length + meta.expectEvent.length + meta.expectNoCycle.length + meta.expectReport.length;
    const status = problems.length ? 'FAIL' : pendingReason ? 'PEND' : 'PASS';
    console.log(`${status}  ${meta.name.padEnd(24)} ${String(cycles).padStart(4)} cycles, ${checks} oracle checks, ${kernelNote}`);
    for (const p of problems) console.log(`      ${p}`);
    if (!problems.length && pendingReason) { pending++; console.log(`      ${pendingReason}`); }
    if (problems.length) failed++;
  }

  console.log(`\n${files.length - failed} of ${files.length} examples passed the oracle checks; ` +
    `${compared} compared with the kernel, ${pending} pending (constructs the kernel does not support yet), ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

main();
