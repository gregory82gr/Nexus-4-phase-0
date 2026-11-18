// NEXUS-4 mutation checks: a test suite that cannot fail proves nothing.
//
// Each mutation below breaks the kernel in index.html in one specific way. The differential
// tests are run against the broken copy and must fail. A mutation the tests do not catch is a
// gap in tests/examples. If a mutation's text is no longer found in index.html (the kernel was
// refactored), this script fails too, so the list is kept up to date with the kernel.
//
// Usage: node tools/mutations.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export const MUTATIONS = [
  { name: 'inertial delay behaves like transport', find: "if (mode === 'inertial') {", replace: 'if (false) {' },
  { name: 'resolution takes the last driver', find: 'if (values.length === 1) return values[0];', replace: 'return values[values.length - 1];' },
  { name: 'no tagging of transactions GHDL leaves out', find: "first.elidable = mode === 'inertial'", replace: "first.elidable = false && mode === 'inertial'" },
  { name: 'rising_edge ignores the previous value', find: 'X01_T[sig.lastValue] === was ? 1 : 0', replace: 'true ? 1 : 0' },
  { name: 'delta counter never advances', find: 'if (tn === this.now && this.cycleAtNow) this.delta++;', replace: 'if (tn === this.now && this.cycleAtNow) this.delta += 0;' },
  { name: 'a signal assignment takes effect at once', find: 'const time = this.now + delay;', replace: 'const time = this.now + delay; if (delay === 0n) { driver.value = el.value(ctx); }' },
  { name: 'severity failure does not stop the run', find: 'if (severity >= 3) this.stopped = true;', replace: 'if (severity >= 9) this.stopped = true;' },
  { name: 'processes are not woken by events', find: 'for (const s of changed) if (w.sens.has(s)) { hit = s; break; }', replace: '' }
];

function main() {
  const original = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const work = mkdtempSync(join(tmpdir(), 'nexus4-mutants-'));
  let survived = 0, stale = 0;
  try {
    for (const m of MUTATIONS) {
      if (!original.includes(m.find)) {
        console.log(`STALE     ${m.name}: its text is no longer in index.html`);
        stale++;
        continue;
      }
      const file = join(work, 'index.html');
      writeFileSync(file, original.replace(m.find, m.replace));
      const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'differential.mjs')],
        { env: { ...process.env, NEXUS4_INDEX: file }, encoding: 'utf8' });
      const caught = run.status !== 0;
      const failing = (run.stdout.match(/^FAIL\s+(\S+)/gm) || []).map((l) => l.split(/\s+/)[1]);
      console.log(`${caught ? 'CAUGHT   ' : 'SURVIVED '} ${m.name}${caught ? `  (by ${failing.join(', ')})` : ''}`);
      if (!caught) survived++;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${MUTATIONS.length - survived - stale} of ${MUTATIONS.length} mutations caught.`);
  process.exit(survived || stale ? 1 : 0);
}

main();
