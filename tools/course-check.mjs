#!/usr/bin/env node
// Checks the course against the kernel, the way the page will use it:
// - every live workbench in a chapter opens an example from tests/examples that is required in CI,
// - every cycle a chapter highlights exists in the run of its example,
// - every drill answer, computed from a run of its example, is one of the question's options,
//   and every "show it" cycle exists.
// The examples are compared with GHDL by tools/differential.mjs, so the drills are graded by the oracle too.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const html = readFileSync(INDEX, 'utf8');

function scriptById(id) {
  const open = `<script id="${id}">`;
  const a = html.indexOf(open);
  if (a < 0) throw new Error(`index.html has no <script id="${id}">`);
  return html.slice(a + open.length, html.indexOf('</script>', a));
}

const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(scriptById('nexus4-kernel'), sandbox, { filename: 'kernel.js' });
vm.runInContext(scriptById('nexus4-course'), sandbox, { filename: 'course.js' });
const kernel = sandbox.NEXUS4.kernel;
const course = sandbox.NEXUS4.course;

let failures = 0, checks = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
const runs = new Map();
function runOf(name) {
  if (!runs.has(name)) {
    const path = join(ROOT, 'tests', 'examples', name);
    if (!existsSync(path)) throw new Error(`${name} is not in tests/examples`);
    const src = readFileSync(path, 'utf8');
    if (!/^--\s*@kernel:\s*required\s*$/mi.test(src)) throw new Error(`${name} is not marked @kernel: required`);
    runs.set(name, course.query(course.runExample(kernel, src)));
  }
  return runs.get(name);
}
function parseSel(s) {
  if (!s) return null;
  if (s === 'init') return ['init', null];
  const m = s.match(/^(.+?)\s*\+(\d+)$/);
  if (!m) throw new Error(`bad cycle "${s}"`);
  return [m[1], +m[2]];
}

for (const ch of course.chapters) {
  for (const b of ch.blocks) {
    try {
      if (b.type === 'bench') {
        checks++;
        const x = runOf(b.example);
        const sel = parseSel(b.select);
        if (sel && !x.hasCycle(sel[0], sel[1])) fail(`${ch.id}: ${b.example} has no cycle ${b.select}`);
      }
      if (b.type === 'drill') {
        b.questions.forEach((q, i) => {
          checks++;
          const x = q.example ? runOf(q.example) : null;
          const ans = q.answer(x);
          if (!q.options.includes(ans)) fail(`${ch.id} drill ${i + 1}: computed answer "${ans}" is not among the options`);
          if (q.show && x) {
            const [t, d] = q.show(x);
            if (!x.hasCycle(t, d)) fail(`${ch.id} drill ${i + 1}: no cycle ${t} +${d} to show`);
          }
          console.log(`ok    ${ch.id} drill ${i + 1}: ${ans}`);
        });
      }
    } catch (e) { fail(`${ch.id}: ${e.message}`); }
  }
}
console.log(`\n${checks} course checks, ${failures} failed.`);
process.exit(failures ? 1 : 0);
