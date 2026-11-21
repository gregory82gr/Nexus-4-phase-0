#!/usr/bin/env node
// Copies every tests/examples/*.vhd into index.html, so the workbench can open the same
// files that CI checks against GHDL; every tests/asm, tests/isa and tests/core program, so the
// assembler page opens the same programs that CI checks against GNU as, Spike and the core; and the
// processor's VHDL (rtl/ and its testbench), so the page runs the same core that CI checks against
// the reference model; and tests/guard, the guardian's programs and property sets that CI runs on the
// core. index.html stays one self-contained file (D1).
//
//   node tools/embed-examples.mjs           write the copies into index.html
//   node tools/embed-examples.mjs --check   fail if the copies in index.html are out of date (CI)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const CLOSE = '</script>';
const SETS = [
  { dir: join(ROOT, 'tests', 'examples'), ext: '.vhd', open: '<script type="application/json" id="nexus4-examples">', what: 'examples', from: 'tests/examples' },
  { dirs: ['asm', 'isa', 'core', 'plant', 'orbit'], ext: '.s', open: '<script type="application/json" id="nexus4-asm-samples">', what: 'assembler samples', from: 'tests/asm, tests/isa, tests/core, tests/plant and tests/orbit' },
  { files: ['rtl/nexus4_pkg.vhd', 'rtl/nexus4_core.vhd', 'rtl/nexus4_soc.vhd', 'tests/core/tb_nexus4.vhd'], open: '<script type="application/json" id="nexus4-rtl">', what: 'processor sources', from: 'rtl and tests/core/tb_nexus4.vhd' },
  { dirs: ['guard'], ext: ['.s', '.json'], open: '<script type="application/json" id="nexus4-guard-samples">', what: 'guardian samples', from: 'tests/guard' }
];

export function examplesJson(set = SETS[0]) {
  const map = {};
  if (set.files) {
    for (const f of set.files) map[f] = readFileSync(join(ROOT, f), 'utf8');
  } else if (set.dir) {
    for (const f of readdirSync(set.dir).filter((f) => f.endsWith(set.ext)).sort()) map[f] = readFileSync(join(set.dir, f), 'utf8');
  } else {
    // keys carry their directory (asm/plant_scan.s, isa/protection_scan.s): the page says which oracle checked each
    for (const d of set.dirs) {
      const dir = join(ROOT, 'tests', d);
      const exts = [].concat(set.ext);
      for (const f of readdirSync(dir).filter((f) => exts.some((x) => f.endsWith(x))).sort()) map[`${d}/${f}`] = readFileSync(join(dir, f), 'utf8');
    }
  }
  // "<" is escaped so that no example text can ever close the script element
  return JSON.stringify(map, null, 1).replace(/</g, '\\u003c');
}

function main() {
  const check = process.argv.includes('--check');
  let html = readFileSync(INDEX, 'utf8');
  let changed = false, stale = false;
  for (const set of SETS) {
    const a = html.indexOf(set.open);
    if (a < 0) { console.error(`index.html has no ${set.open} element`); process.exit(1); }
    const b = html.indexOf(CLOSE, a);
    const current = html.slice(a + set.open.length, b);
    const wanted = `\n${examplesJson(set)}\n`;
    if (current === wanted) { console.log(`embedded ${set.what} are up to date`); continue; }
    if (check) { console.error(`The ${set.what} embedded in index.html differ from ${set.from}. Run: node tools/embed-examples.mjs`); stale = true; continue; }
    html = html.slice(0, a + set.open.length) + wanted + html.slice(b);
    changed = true;
    console.log(`embedded ${Object.keys(JSON.parse(wanted)).length} ${set.what} into index.html`);
  }
  if (stale) process.exit(1);
  if (changed) writeFileSync(INDEX, html);
}

main();
