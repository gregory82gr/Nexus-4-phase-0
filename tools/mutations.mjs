// NEXUS-4 mutation checks: a test suite that cannot fail proves nothing.
//
// Each mutation below breaks the kernel in index.html in one specific way (the cycle, composite values, numeric_std). The differential
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
  // the simulation cycle
  { name: 'inertial delay behaves like transport', find: "if (mode === 'inertial') {", replace: 'if (false) {' },
  { name: 'resolution takes the last driver', find: 'if (values.length === 1) return values[0];', replace: 'return values[values.length - 1];' },
  { name: 'no tagging of transactions GHDL leaves out', find: "first.elidable = mode === 'inertial'", replace: "first.elidable = false && mode === 'inertial'" },
  { name: 'rising_edge ignores the previous value', find: 'X01_T[leaf.lastValue] === was ? 1 : 0', replace: 'true ? 1 : 0' },
  { name: 'delta counter never advances', find: 'if (tn === this.now && this.cycleAtNow) this.delta++;', replace: 'if (tn === this.now && this.cycleAtNow) this.delta += 0;' },
  { name: 'a signal assignment takes effect at once', find: 'const rel = off - s.sOff;', replace: 'const rel = off - s.sOff; if (times[0] === this.now) flats[0].forEach((v, k) => { s.drivers[rel + k].sig.value = v; });' },
  { name: 'severity failure does not stop the run', find: 'if (severity >= 3) this.stopped = true;', replace: 'if (severity >= 9) this.stopped = true;' },
  { name: 'processes are not woken by events', find: 'for (const s of changed) for (const p of s.waiters) if (!cand.has(p)) cand.set(p, s);', replace: '' },
  { name: 'a wait until condition is ignored', find: 'if (!p.wait.until || p.wait.until(p.wait.uctx || p.ctx)) wake.push', replace: 'if (true) wake.push' },
  // composite values and numeric_std (v0.2)
  { name: 'a metavalue operand still gives a number', find: 'if (!xb || !yb) return allX(size);', replace: 'if (!xb || !yb) return numFrom(0n, size);' },
  { name: 'signed values compared as unsigned', find: 'u = bigOf(bb, signed); } else u = BigInt(x);', replace: 'u = bigOf(bb, false); } else u = BigInt(x);' },
  { name: 'no numeric_std metavalue warning', find: "if (lc === 'vec') { const bb = bitsOf(x); if (!bb) { warn(ctx, metaText);", replace: "if (lc === 'vec') { const bb = bitsOf(x); if (!bb) { void metaText;" },
  { name: 'to_hstring without To_X01', find: 'const x01 = g.map((x) => X01_T[x]);', replace: 'const x01 = g;' },
  { name: 'concatenation in the wrong order', find: 'const elems = (la ? x.e : [x]).concat(ra ? y.e : [y]);', replace: 'const elems = (ra ? y.e : [y]).concat(la ? x.e : [x]);' },
  { name: 'to and downto swapped when indexing', find: "const p = dir === 'to' ? i - left : left - i;", replace: "const p = dir === 'downto' ? i - left : left - i;" },
  { name: 'case ignores its choices', find: 'let ai = map.get(key);', replace: 'let ai = undefined;' },
  { name: 'exit behaves like next', find: "return r.k === 'exit' ? 'break' : 'go';", replace: "return 'go';" },
  { name: 'sign extension replaced by zero extension', find: "new Array(len - n).fill(v.e[0]).concat(v.e)", replace: 'new Array(len - n).fill(SL_0).concat(v.e)' },
  // v0.3: hierarchy and subprograms
  { name: 'instance path without the entity', find: '`${scope.prefix}.${s.label}@${entity.name}(${arch.name})`', replace: '`${scope.prefix}.${s.label}`' },
  { name: 'port drivers start from the actual', find: 'drivers = leaves.map((l, k) => this.driverFor(owner, l, di ? di[r.sOff + k] : undefined));\n      const alts', replace: 'drivers = leaves.map((l, k) => this.driverFor(owner, l, undefined));\n      const alts' },
  { name: 'for-generate index left out of the name', find: 'prefix: `${scope.prefix}.${s.label}(${i})`', replace: 'prefix: `${scope.prefix}.${s.label}`' },
  { name: 'procedure waits ignore signal parameters', find: 'for (const m of s.markers) { const b = ctx.sigs[m.sigparam];', replace: 'for (const m of []) { const b = ctx.sigs[m.sigparam];' },
  { name: 'out variable parameters not copied back', find: "if (a.kind !== 'var') continue;", replace: 'continue;' },
  { name: 'local bounds from the argument not set', find: 'if (x.range) frame.ranges[x.slot] = x.range(frame);', replace: 'void x.range;' },
  { name: 'string equality inverted', find: "'=': (x, y) => x === y, '/=': (x, y) => x !== y", replace: "'=': (x, y) => x !== y, '/=': (x, y) => x === y" },
  { name: 'overloads resolved to the first', find: "if (viable.length > 1) throw new VhdlError(`the call to '${name}' is ambiguous`, call.at);\n      return viable[0];", replace: "return { sp: entry.overloads.find((x) => x.isFunc === wantFunc), actuals: viable[0].actuals };" },
  { name: 'default parameter values ignored', find: 'const c = a ? this.expr(a, scope, p.type, reads) : this.compile(p.init, sp.scope, p.type, null);\n          this.checkAssignable(p.type, c.t, a ? a.at : e.at);', replace: 'const c = a ? this.expr(a, scope, p.type, reads) : this.compile({ kind: \'int\', value: 0, at: e.at }, sp.scope, p.type, null);\n          this.checkAssignable(p.type, c.t, a ? a.at : e.at);' },
  { name: 'selected assignment drives the wrong target', find: "body: [{ kind: 'sigassign', target: s.target, mode: s.mode,", replace: "body: [{ kind: 'sigassign', target: { kind: 'name', id: 'count', at: s.at }, mode: s.mode," },
  // v0.3.2
  { name: 'to_x01 passes weak values through', find: 'if (isSl(c.t)) return C(T.std_ulogic, (ctx) => X01_T[f(ctx)], c.dyn);', replace: 'if (isSl(c.t)) return C(T.std_ulogic, (ctx) => f(ctx), c.dyn);' }
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
