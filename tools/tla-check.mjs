#!/usr/bin/env node
// NEXUS-4 tla-check (D58, D61): TLC, the TLA+ model checker, as the oracle for the guardian's properties.
//
// A property module (tests/guard/*.tla, EXTENDS NexusGuard) is read twice: by the translator in the page
// (NEXUS4.guard.translate), which turns it into the guardian's table, and by TLC, which knows only TLA+.
// For each program of tests/guard, the core's commits (the model's, which core-check holds equal to GHDL's
// on every commit and cycle) become a trace, and TLC checks that trace against the module itself, by trace
// validation (Cirstea, Kuppe, Loillier and Merz, 2024): is it a behaviour the module allows, and if not,
// where does it stop being one? TLC's answer must be the guardian's: the same kind of violation (which
// invariant definition, an event the automata do not allow, which deadline, a part-word store) in the same
// cycle, or none. In ORBIT, each run between two restarts is a trace of its own.
//
// Checked too: SANY parses every module; the translator refuses, with the right reason, modules that are
// valid TLA+ but outside the subset; and with --mutations, deliberate bugs in the translator must each make
// TLC disagree with the guardian.
//
//   NEXUS4_TLC=/path/to/tla2tools.jar node tools/tla-check.mjs [--mutations]
// The jar is TLA+ tools v1.7.4 (sha1 bee4a54f3ee3d4afc347c3240ec2d9e93b075104); CI downloads and checks it.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, read, loadNexus, programPackage, modelRun, orbitModelRun } from './core-sim.mjs';

const JAR = process.env.NEXUS4_TLC || join(ROOT, '.cache', 'tla2tools.jar');
if (!existsSync(JAR)) { console.error(`TLC not found at ${JAR}: set NEXUS4_TLC to tla2tools.jar (v1.7.4)`); process.exit(2); }
const GUARD = join(ROOT, 'tests', 'guard');
const work = mkdtempSync(join(tmpdir(), 'nexus4-tla-'));
let checks = 0, failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);
const java = (args, cwd) => spawnSync('java', ['-XX:+UseParallelGC', '-cp', JAR, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
const modules = readdirSync(GUARD).filter((f) => f.endsWith('.tla'));
const header = (src, key) => (new RegExp(`^#\\s*@${key}\\s+(\\S+)`, 'm').exec(src) || [])[1];
const PROFILES = { base: 0, plant: 1, orbit: 2 };

// ---------- 1. SANY parses every module ----------
for (const f of modules) copyFileSync(join(GUARD, f), join(work, f));
for (const f of modules) {
  checks++;
  const r = java(['tla2sany.SANY', f], work);
  const out = r.stdout + r.stderr;
  if (r.status !== 0 || /\*\*\* Errors|Fatal errors|Could not parse/.test(out)) fail(`SANY rejects ${f}:\n${out.split('\n').filter((l) => /error|Error|line/.test(l)).slice(0, 8).join('\n')}`);
  else ok(`SANY parses ${f}`);
}

// ---------- the traces ----------
const tlaStr = (s) => `"${s}"`;
/**
 * The trace modules for a run: one per stretch of commits between restarts.
 * Each stretch gives TLC the log of what the guardian watches: stores to the mapped variables (with their
 * size: the guardian keeps whole words, so a part-word store is no step of the module) and the events. The
 * clock ticks between entries. `armed` is D59's rule after an ORBIT restart: the invariants are checked
 * again from the next store to a mapped variable (and from the first cycle after reset).
 */
function traces(tla, table, run, data, name) {
  const mod = tla.mod, spec = tla.spec;
  const mapped = Object.keys(spec.vars), evNames = Object.keys(spec.events);
  const guardVars = mod.variables.map((v) => v.name).filter((v) => !mapped.includes(v));
  const byAddr = new Map(table.addr.map((a, i) => [a, mapped[i]]));
  const ids = new Map(evNames.map((e) => [spec.events[e], e]));
  const vals = {};
  mapped.forEach((v, i) => { const k = (table.addr[i] - 0x10000) >>> 2; vals[v] = data[k] | 0; });
  const bounds = [...(run.restarts || []).map((r) => r.cycle)];
  const segs = [];
  let from = 0, armed = true, k = 0;
  const steps = run.steps;
  for (let s = 0; s <= bounds.length; s++) {
    const until = s < bounds.length ? bounds[s] : Infinity;
    const log = [];
    const start = { ...vals };
    while (k < steps.length && steps[k].cycle <= until) {
      const { rec, cycle } = steps[k++];
      if (rec.mem && rec.mem.store && byAddr.has(rec.mem.addr & ~3)) {
        const v = byAddr.get(rec.mem.addr & ~3);
        log.push({ at: cycle, store: v, val: rec.mem.data | 0, size: rec.mem.size });
        if (rec.mem.size === 4) vals[v] = rec.mem.data | 0;
      } else if (rec.mark && ids.has(rec.mark.id)) log.push({ at: cycle, event: ids.get(rec.mark.id) });
    }
    const last = s < bounds.length ? until : Math.max(from, steps.length ? steps[steps.length - 1].cycle : 0);
    segs.push({ from, last, log, start, armed });
    from = until + 1;
    armed = false;
  }
  return segs.map((g, n) => {
    const mname = `Trace_${name.replace(/\W/g, '_')}_${n}`;
    const others = (x) => `<<${x.join(', ')}>>`;
    const steps2 = g.log.map((e, i) => {
      const at = `l = ${i + 1} /\\ now = ${e.at}`;
      if (e.store) {
        if (e.size !== 4) return `   \\* ${i + 1}: a ${e.size === 1 ? 'byte' : 'half-word'} store to ${e.store}: no step of the module (the guardian keeps whole words)`;
        return `   \\/ ${at} /\\ ${e.store}' = ${e.val} /\\ UNCHANGED ${others([...mapped.filter((v) => v !== e.store), ...guardVars, 'now'])} /\\ armed' = TRUE /\\ l' = ${i + 2}`;
      }
      return `   \\/ ${at} /\\ ${e.event} /\\ UNCHANGED ${others([...mapped, 'now', 'armed'])} /\\ l' = ${i + 2}`;
    });
    const invDefs = [...new Set(tla.invOf)];
    const src = [
      `---- MODULE ${mname} ----`,
      `\\* A trace of ${name}, cycles ${g.from} to ${g.last}${n ? `, after restart ${n}` : ''} (written by tools/tla-check.mjs)`,
      `EXTENDS ${mod.name}, TLC, Sequences`,
      'VARIABLES l, armed',
      `At == <<${g.log.map((e) => e.at).join(', ')}>>`,
      `End == IF l <= Len(At) THEN At[l] ELSE ${g.last}`,
      `TInit == Init /\\ ${mapped.map((v) => `${v} = ${g.start[v]}`).join(' /\\ ')} /\\ now = ${g.from} /\\ l = 1 /\\ armed = ${g.armed ? 'TRUE' : 'FALSE'}`,
      'TNext ==',
      `   \\/ now < End /\\ now' = now + 1 /\\ UNCHANGED ${others([...mapped, ...guardVars, 'l', 'armed'])}`,
      ...steps2,
      `   \\/ l > Len(At) /\\ now = End /\\ UNCHANGED ${others([...mapped, ...guardVars, 'now', 'l', 'armed'])}`,
      ...invDefs.map((d) => `Armed_${d} == armed => ${d}`),
      '===='
    ].join('\n');
    const cfg = ['INIT TInit', 'NEXT TNext', ...invDefs.map((d) => `INVARIANT Armed_${d}`), ...spec.deadlines.map((d) => `INVARIANT ${d.name}`)].join('\n') + '\n';
    return { name: mname, src, cfg, seg: g };
  });
}
// TLC's verdict on a trace: none, or { kind, def, cycle }
function tlc(t) {
  writeFileSync(join(work, `${t.name}.tla`), t.src);
  writeFileSync(join(work, `${t.name}.cfg`), t.cfg);
  const r = java(['tlc2.TLC', '-workers', '1', '-metadir', join(work, 'states', t.name), '-config', `${t.name}.cfg`, `${t.name}.tla`], work);
  const out = r.stdout + r.stderr;
  if (/Model checking completed\. No error has been found/.test(out)) return { none: true };
  const states = out.split(/\nState \d+:/);
  const lastState = states[states.length - 1];
  const val = (n) => { const m = new RegExp(`/\\\\ ${n} = (-?\\d+)`).exec(lastState); return m ? Number(m[1]) : null; };
  let m;
  if ((m = /Error: Invariant (\w+) is violated/.exec(out))) {
    const def = m[1].replace(/^Armed_/, '');
    return { kind: m[1].startsWith('Armed_') ? 'invariant' : 'deadline', def, cycle: val('now') };
  }
  if (/Error: Deadlock reached/.test(out)) {
    const l = val('l');
    const e = t.seg.log[l - 1];
    return { kind: e && e.store ? 'map' : 'event', entry: l, cycle: val('now') };
  }
  return { error: out.split('\n').filter((x) => /Error|error/.test(x)).slice(0, 6).join('\n') || out.slice(-800) };
}
// the guardian's verdict, in TLC's terms
function expected(table, tla, v) {
  if (!v) return { none: true };
  if (v.code >= 1 && v.code <= 8) return { kind: 'invariant', def: tla.invOf[v.code - 1], cycle: v.cycle };
  if (v.code === 9 || v.code === 10) return { kind: 'event', cycle: v.cycle };
  if (v.code >= 11 && v.code <= 14) return { kind: 'deadline', def: tla.spec.deadlines[v.code - 11].name, cycle: v.cycle };
  return { kind: 'map', cycle: v.cycle };
}
const say = (x) => (x.none ? 'none' : x.error ? `TLC error: ${x.error}` : `${x.kind}${x.def ? ` ${x.def}` : ''} at cycle ${x.cycle}`);

function validate(N4, quiet) {
  let bad = 0, n = 0;
  for (const f of readdirSync(GUARD).filter((x) => x.endsWith('.s')).sort()) {
    const src = read(join(GUARD, f));
    const tlaSrc = read(join(GUARD, header(src, 'guard')));
    const prog = N4.asm.assemble(src);
    let table;
    try { table = N4.guard.buildTla(tlaSrc, prog); } catch (e) { bad++; if (!quiet) fail(`${f}: the module does not translate: ${e.message}`); continue; }
    const profile = PROFILES[header(src, 'profile') || 'base'];
    const pkg = programPackage(prog, { profile, guard: table.words });
    const run = profile === 2 ? orbitModelRun(N4, prog, pkg, 200000) : modelRun(N4, prog, pkg, 200000);
    const data = pkg.data;
    const ts = traces(table.tla, table, run, data, f.replace(/\.s$/, ''));
    // the guardian's violations, by stretch: the first in each
    const verdicts = [];
    for (const t of ts) {
      n++;
      checks += quiet ? 0 : 1;
      const v = run.guards.find((g) => g.cycle >= t.seg.from && g.cycle <= t.seg.last);
      const want = expected(table, table.tla, v), got = tlc(t);
      const same = !got.error && (got.none ? !!want.none : !want.none && got.kind === want.kind && (got.def || null) === (want.def || null) && got.cycle === want.cycle);
      if (!same) { bad++; if (!quiet) fail(`${f}${ts.length > 1 ? `, stretch ${ts.indexOf(t) + 1}` : ''}: TLC says ${say(got)}, the guardian ${say(want)}`); }
      verdicts.push(say(got));
    }
    if (!quiet && verdicts.length) ok(`${f}: TLC agrees with the guardian: ${verdicts.join('; ')} (${ts.reduce((s, t) => s + t.seg.log.length, 0)} log entries)`);
  }
  return { bad, n };
}

// ---------- 2. trace validation ----------
const N4 = loadNexus(join(ROOT, 'index.html'));
const res = validate(N4, false);
console.log(`      ${res.n} traces checked by TLC`);

// ---------- 3. what the translator must refuse (each case is valid TLA+: SANY must accept it) ----------
const rods = read(join(GUARD, 'Rods.tla'));
const variant = (from, to) => { if (!rods.includes(from)) throw new Error(`tla-check: stale case, "${from}" is not in Rods.tla`); return rods.replace(from, to); };
const REFUSED = [
  ['a coefficient of 2', variant('/\\ trip <= 1', '/\\ trip + trip <= 1'), /coefficient/],
  ['a product', variant('/\\ trip <= 1', '/\\ trip * pos <= 1'), /no "\*"/],
  ['an action that changes a mapped variable', variant('Insert   == UNCHANGED <<mode, scramAt>>', 'Insert   == pos\' = pos /\\ UNCHANGED <<mode, scramAt>>'), /may not test or change the mapped variables/],
  ['an action that leaves a deadline unsaid', variant('Withdraw == mode = "run" /\\ UNCHANGED <<mode, scramAt>>', 'Withdraw == mode = "run" /\\ UNCHANGED mode'), /does not say what happens to scramAt/],
  ['a deadline started by two events', variant('Insert   == UNCHANGED <<mode, scramAt>>', 'Insert   == UNCHANGED mode /\\ Start(scramAt)'), /one start event and one stop event/],
  ['a nondeterministic automaton', variant('Reset    == mode\' = "run" /\\ UNCHANGED scramAt', 'Reset    == UNCHANGED scramAt /\\ (\\/ mode\' = "run" \\/ mode\' = "scrammed")'), /deterministic/],
  ['Init setting a mapped variable', variant('Init == mode = "run" /\\ scramAt = None', 'Init == mode = "run" /\\ scramAt = None /\\ pos = 0'), /data image/],
  ['a temporal formula', variant('RodsInOnTime == Within(scramAt, 90)', 'RodsInOnTime == Within(scramAt, 90)\nLive == <>(mode = "run")'), /no "<"|no "<>"|subset has no/],
  ['a module from outside the subset', variant('EXTENDS NexusGuard', 'EXTENDS NexusGuard, Sequences'), /extends only/],
  ['a deadline of a variable length', variant('Within(scramAt, 90)', 'Within(scramAt, pos)'), /a number of cycles/],
  ['an action that reads the clock', variant('Withdraw == mode = "run" /\\ UNCHANGED', 'Withdraw == mode = "run" /\\ now > 3 /\\ UNCHANGED'), /may not use the clock/],
  ['an invariant over an automaton', variant('/\\ trip <= 1', '/\\ trip <= 1\n          /\\ scramAt <= 1'), /not a mapped variable/]
];
for (const [what, src, why] of REFUSED) {
  checks++;
  const file = `Refused_${REFUSED.findIndex((x) => x[0] === what)}`;
  writeFileSync(join(work, `${file}.tla`), src.replace('MODULE Rods ', `MODULE ${file} `));
  const sany = java(['tla2sany.SANY', `${file}.tla`], work);
  const sout = sany.stdout + sany.stderr;
  if (sany.status !== 0 || /\*\*\* Errors|Fatal errors|Could not parse/.test(sout)) { fail(`refused case "${what}" is not valid TLA+, so it does not test the subset:\n${sout.split('\n').filter((l) => /rror|line/.test(l)).slice(0, 5).join('\n')}`); continue; }
  try { N4.guard.translate(src); fail(`the translator accepts ${what}`); }
  catch (e) { if (why.test(e.message)) ok(`refused, valid TLA+ outside the subset: ${what} (${e.message})`); else fail(`the translator refuses ${what} for the wrong reason: ${e.message}`); }
}

// ---------- 4. mutations of the translator: TLC must disagree with each ----------
const MUTATIONS = [
  { name: 'a comparison <= read as <', find: "'<=': '<=', '<': '<'", replace: "'<=': '<', '<': '<'" },
  { name: 'a subtraction read as an addition', find: "case 'add': return `${show(e.a)} ${e.op} ${show(e.b)}`;", replace: "case 'add': return `${show(e.a)} + ${show(e.b)}`;" },
  { name: 'Start and Stop swapped', find: "eff.timer[c.args[0].name] = c.name === 'Start' ? 'start' : 'stop';", replace: "eff.timer[c.args[0].name] = c.name === 'Start' ? 'stop' : 'start';" },
  { name: 'a guard a = "s" ignored', find: "g.guard = new Set(g.guard ? [...g.guard].filter((s) => s === c.b.v) : [c.b.v]); return; }", replace: 'return; }' },
  { name: 'UNCHANGED read as a return to the first state', find: "if (autVars.includes(x.name)) { const g = tgt(x.name); if (g.next !== undefined) fail(A, `${ev}: ${x.name}' is given twice`); g.next = '='; }", replace: "if (autVars.includes(x.name)) { const g = tgt(x.name); g.next = init[x.name]; }" },
  { name: 'Within one cycle longer', find: 'within: b.args[1].v, line: d.line', replace: 'within: b.args[1].v + 1, line: d.line' }
];
if (process.argv.includes('--mutations')) {
  const index = read(join(ROOT, 'index.html'));
  let caught = 0;
  for (const mu of MUTATIONS) {
    checks++;
    const n = index.split(mu.find).length - 1;
    if (n !== 1) { fail(`mutation "${mu.name}": its text occurs ${n} times`); continue; }
    const file = join(work, 'mutated.html');
    writeFileSync(file, index.replace(mu.find, mu.replace));
    let r;
    try { r = validate(loadNexus(file), true); } catch (e) { r = { bad: 1 }; }
    if (r.bad) { caught++; ok(`mutation caught: ${mu.name}`); }
    else fail(`mutation survived: ${mu.name}`);
  }
  console.log(`      ${caught} of ${MUTATIONS.length} translator mutations caught by TLC`);
}

rmSync(work, { recursive: true, force: true });
console.log(`${checks} TLA+ checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
