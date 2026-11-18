// NEXUS-4 oracle: runs an example through GHDL and parses its delta-level trace.
//
// GHDL is run with --std=08 and --trace-signals. After initialisation and after
// every simulation cycle GHDL prints one line per scalar signal (composites are
// already split into scalar subelements, e.g. ".top(rtl).m(1)(0)"), and before
// each cycle a header "Now is <time> +<delta>". The block that follows a header
// is the state after the update phase of that cycle; A and E in the flag column
// mean "active" and "event" in that cycle. This format is a debugging aid, not a
// stable interface, so the GHDL version is pinned (see REQUIRED_GHDL).
//
// Usage as a CLI:  node tools/oracle.mjs tests/examples/delta_chain.vhd

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_GHDL = /^GHDL 4\.1\./;

const UNIT_FS = { fs: 1n, ps: 1000n, ns: 1000000n, us: 1000000000n, ms: 1000000000000n, sec: 1000000000000000n };
const END_OF_TIME_FS = 9223372036854775807n; // GHDL prints this time after the last cycle

/** Parses a GHDL time such as "0ms", "1ns", "9223372036854775807fs" into femtoseconds (BigInt). */
export function parseTime(text) {
  const m = /^(-?\d+)(fs|ps|ns|us|ms|sec)$/.exec(text.trim());
  if (!m) throw new Error(`Unrecognised time "${text}"`);
  return BigInt(m[1]) * UNIT_FS[m[2]];
}

/** Formats femtoseconds with the largest unit that divides it exactly, e.g. 1000000n -> "1ns". */
export function formatTime(fs) {
  for (const unit of ['sec', 'ms', 'us', 'ns', 'ps']) {
    if (fs !== 0n && fs % UNIT_FS[unit] === 0n) return `${fs / UNIT_FS[unit]}${unit}`;
  }
  return `${fs}fs`;
}

/** Reads the "-- @key: value" header of an example file. */
export function readMeta(file) {
  const source = readFileSync(file, 'utf8');
  const meta = { file, name: basename(file, '.vhd'), top: null, stop: null, purpose: '', expect: [], expectEvent: [], expectNoCycle: [], expectReport: [] };
  for (const line of source.split(/\r?\n/)) {
    const m = /^--\s*@([\w-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'top') meta.top = value.trim();
    else if (key === 'stop') meta.stop = value.trim();
    else if (key === 'purpose') meta.purpose = value.trim();
    else if (key === 'expect') meta.expect.push(parseExpect(value, true));
    else if (key === 'expect-event') meta.expectEvent.push(parseExpect(value, false));
    else if (key === 'expect-no-cycle') meta.expectNoCycle.push(parseCycle(value));
    else if (key === 'expect-report') meta.expectReport.push(value.trim());
  }
  if (!meta.top || !meta.stop) throw new Error(`${file}: missing "-- @top:" or "-- @stop:" header`);
  return { meta, source };
}

function parseCycle(text) {
  const m = /^(\S+)\s*\+(\d+)\s*$/.exec(text.trim());
  if (!m) throw new Error(`Malformed cycle "${text}"`);
  return { time: parseTime(m[1]), delta: Number(m[2]) };
}

function parseExpect(text, withValue) {
  const re = withValue
    ? /^(\S+)\s*=\s*(.+?)\s*@\s*(\S+)\s*\+(\d+)\s*$/
    : /^(\S+)\s*@\s*(\S+)\s*\+(\d+)\s*$/;
  const m = re.exec(text.trim());
  if (!m) throw new Error(`Malformed expectation "${text}"`);
  return withValue
    ? { signal: m[1], value: m[2], time: parseTime(m[3]), delta: Number(m[4]) }
    : { signal: m[1], time: parseTime(m[2]), delta: Number(m[3]) };
}

const SIGNAL_LINE = /^(\.\S+)\s+[0-9A-Fa-f]+\s+(\w+)\s+([-A-Za-z]{7})\s+last_event=\S+\s+last_active=\S+\s+val=(.*?); drv=(.*)$/;
const CYCLE_LINE = /^Now is (\S+) \+(\d+)$/;
const REPORT_LINE = /^(.*?):(\d+):(\d+):@(\S+):\((report|assertion) (\w+)\): (.*)$/;

/**
 * Parses GHDL stdout into snapshots and messages.
 * snapshots[0] is the state after initialisation (time null, delta null).
 */
export function parseTrace(stdout) {
  const snapshots = [];
  const reports = [];
  let current = { time: null, delta: null, signals: {} };
  snapshots.push(current);
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = CYCLE_LINE.exec(line))) {
      current = { time: parseTime(m[1]), delta: Number(m[2]), signals: {} };
      snapshots.push(current);
    } else if ((m = SIGNAL_LINE.exec(line))) {
      const flags = m[3];
      current.signals[m[1]] = { type: m[2], val: m[4], drv: m[5], active: flags.includes('A'), event: flags.includes('E') };
    } else if ((m = REPORT_LINE.exec(line))) {
      reports.push({ file: m[1], line: Number(m[2]), col: Number(m[3]), time: parseTime(m[4]), kind: m[5], severity: m[6], text: m[7] });
    }
  }
  // GHDL closes the run with a block at the maximum time; it is not a real cycle.
  const last = snapshots[snapshots.length - 1];
  if (last.time === END_OF_TIME_FS) snapshots.pop();
  return { snapshots, reports };
}

function ghdl(args, cwd) {
  return execFileSync('ghdl', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

export function ghdlVersion() {
  return ghdl(['--version'], process.cwd()).split('\n')[0].trim();
}

/** Analyses, elaborates and runs one example in a scratch directory and returns the parsed trace. */
export function runOracle(file) {
  const { meta } = readMeta(file);
  const work = mkdtempSync(join(tmpdir(), 'nexus4-oracle-'));
  try {
    ghdl(['-a', '--std=08', resolve(file)], work);
    ghdl(['-e', '--std=08', meta.top], work);
    // The trace goes to stdout and report/assert messages to stderr. Both are kept;
    // a failing assertion ends the run with a non-zero status, and its output is still the oracle.
    const run = spawnSync('ghdl', ['-r', '--std=08', meta.top, `--stop-time=${meta.stop}`, '--trace-signals'],
      { cwd: work, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (run.error) throw run.error;
    return { meta, exitStatus: run.status, ...parseTrace(`${run.stdout}\n${run.stderr}`) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Checks the example's own @expect lines against a trace. Returns a list of failure messages. */
export function checkExpectations(meta, trace) {
  const failures = [];
  const find = (time, delta) => trace.snapshots.find((s) => s.time === time && s.delta === delta);
  for (const e of meta.expect) {
    const snap = find(e.time, e.delta);
    const sig = snap?.signals[e.signal];
    if (!snap) failures.push(`no cycle ${formatTime(e.time)} +${e.delta}`);
    else if (!sig) failures.push(`no signal ${e.signal} at ${formatTime(e.time)} +${e.delta}`);
    else if (sig.val !== e.value) failures.push(`${e.signal} @ ${formatTime(e.time)} +${e.delta}: expected ${e.value}, got ${sig.val}`);
  }
  for (const e of meta.expectEvent) {
    const snap = find(e.time, e.delta);
    const sig = snap?.signals[e.signal];
    if (!sig) failures.push(`no signal ${e.signal} at ${formatTime(e.time)} +${e.delta}`);
    else if (!sig.event) failures.push(`${e.signal}: expected an event at ${formatTime(e.time)} +${e.delta}`);
  }
  for (const c of meta.expectNoCycle) {
    if (find(c.time, c.delta)) failures.push(`cycle ${formatTime(c.time)} +${c.delta} should not appear`);
  }
  for (const text of meta.expectReport) {
    if (!trace.reports.some((r) => r.text.includes(text))) failures.push(`no report containing "${text}"`);
  }
  return failures;
}

// CLI: print the parsed trace of one example as JSON.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/oracle.mjs <example.vhd>');
    process.exit(2);
  }
  const trace = runOracle(file);
  console.log(JSON.stringify(trace, (k, v) => (typeof v === 'bigint' ? formatTime(v) : v), 2));
}
