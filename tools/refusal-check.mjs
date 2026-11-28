// NEXUS-4 refusal checks: what the kernel refuses, and why, against what GHDL does with the same file.
//
// tools/differential.mjs compares designs both simulators run. This tool covers the files the kernel must NOT run:
// a design that VHDL forbids (the kernel must reject it as GHDL does), a construct outside the kernel's subset (the
// kernel must say "not supported", never that a legal design is wrong: decision D32), and the cases where the kernel
// is deliberately stricter than GHDL. Each file in tests/refusals carries:
//   -- @top: <entity>
//   -- @kernel-refuses: error: <text>          a VhdlError whose message contains <text> (the design is wrong)
//   -- @kernel-refuses: unsupported: <text>    an error with code NEXUS4_UNSUPPORTED containing <text>
//   -- @ghdl: refuses: <text>                  analysis or elaboration fails with <text>
//   -- @ghdl: warns: <text>                    analysis prints the warning <text> and elaboration succeeds
//   -- @ghdl: accepts                          analysis and elaboration succeed, and so does a run to @stop
//   -- @stop: <time>                           (with accepts) how long GHDL runs it
// Decisions D72 and D73; found while writing the book's Chapters 13 and 15.
//
// Usage: node tools/refusal-check.mjs   (NEXUS4_INDEX points it at another copy of index.html, for mutations)

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadKernel } from './kernel-runner.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'tests', 'refusals');
const kernel = loadKernel(process.env.NEXUS4_INDEX || join(ROOT, 'index.html'));

function header(source, key) {
  const m = new RegExp(`^--\\s*@${key}:\\s*(.*)$`, 'm').exec(source);
  return m ? m[1].trim() : null;
}

function ghdl(file, top, stop) {
  const work = mkdtempSync(join(tmpdir(), 'nexus4-refusal-'));
  const run = (args) => spawnSync('ghdl', args, { cwd: work, encoding: 'utf8' });
  try {
    const a = run(['-a', '--std=08', file]);
    if (a.status !== 0) return { ok: false, out: a.stdout + a.stderr };
    const e = run(['-e', '--std=08', top]);
    if (e.status !== 0) return { ok: false, out: a.stdout + a.stderr + e.stdout + e.stderr };
    let out = a.stdout + a.stderr + e.stdout + e.stderr, ran = true;
    if (stop) { const r = run(['-r', '--std=08', top, `--stop-time=${stop}`]); out += r.stdout + r.stderr; ran = r.status === 0; }
    return { ok: ran, out };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

let failed = 0;
const files = readdirSync(DIR).filter((f) => f.endsWith('.vhd')).sort();
for (const name of files) {
  const file = join(DIR, name);
  const source = readFileSync(file, 'utf8');
  const top = header(source, 'top'), stop = header(source, 'stop');
  const want = /^(error|unsupported):\s*(.+)$/.exec(header(source, 'kernel-refuses') || '');
  const gwant = /^(refuses|warns|accepts)(?::\s*(.+))?$/.exec(header(source, 'ghdl') || '');
  const problems = [];
  if (!top || !want || !gwant) problems.push('missing or malformed @top, @kernel-refuses or @ghdl header');
  else {
    let err = null;
    try { kernel.simulate({ source, top, stop: stop || '1ns', snapshots: false, log: false }); } catch (e) { err = e; }
    if (!err) problems.push('the kernel accepted it');
    else {
      const unsupported = err.code === 'NEXUS4_UNSUPPORTED';
      const isVhdl = err.name === 'VhdlError';
      if (want[1] === 'unsupported' && !unsupported) problems.push(`the kernel should say "not supported", and said (${err.name}) ${err.message}`);
      if (want[1] === 'error' && (!isVhdl || unsupported)) problems.push(`the kernel should report an error in the design, and said (${err.name}) ${err.message}`);
      if (!String(err.message).includes(want[2])) problems.push(`the kernel's message is "${err.message}", without "${want[2]}"`);
    }
    const g = ghdl(file, top, gwant[1] === 'accepts' ? stop : null);
    if (gwant[1] === 'refuses' && (g.ok || !g.out.includes(gwant[2]))) problems.push(`GHDL should refuse it with "${gwant[2]}": ${g.out.split('\n')[0]}`);
    if (gwant[1] === 'warns' && (!g.ok || !g.out.includes(`warning: ${gwant[2]}`))) problems.push(`GHDL should accept it with the warning "${gwant[2]}": ${g.out.split('\n')[0]}`);
    if (gwant[1] === 'accepts' && !g.ok) problems.push(`GHDL should accept and run it: ${g.out.split('\n')[0]}`);
  }
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${name.replace(/\.vhd$/, '').padEnd(24)} kernel ${want ? want[1] : '?'}, GHDL ${gwant ? gwant[1] : '?'}`);
  for (const p of problems) console.log(`      ${p}`);
  if (problems.length) failed++;
}
console.log(`\n${files.length - failed} of ${files.length} refusals as expected.`);
process.exit(failed ? 1 : 0);
