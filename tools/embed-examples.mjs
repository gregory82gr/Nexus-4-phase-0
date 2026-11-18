#!/usr/bin/env node
// Copies every tests/examples/*.vhd into index.html, so the workbench can open the same
// files that CI checks against GHDL. index.html stays one self-contained file (D1).
//
//   node tools/embed-examples.mjs           write the copies into index.html
//   node tools/embed-examples.mjs --check   fail if the copies in index.html are out of date (CI)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.NEXUS4_INDEX || join(ROOT, 'index.html');
const DIR = join(ROOT, 'tests', 'examples');
const OPEN = '<script type="application/json" id="nexus4-examples">';
const CLOSE = '</script>';

export function examplesJson() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.vhd')).sort();
  const map = {};
  for (const f of files) map[f] = readFileSync(join(DIR, f), 'utf8');
  // "<" is escaped so that no example text can ever close the script element
  return JSON.stringify(map, null, 1).replace(/</g, '\\u003c');
}

function main() {
  const check = process.argv.includes('--check');
  const html = readFileSync(INDEX, 'utf8');
  const a = html.indexOf(OPEN);
  if (a < 0) { console.error(`index.html has no ${OPEN} element`); process.exit(1); }
  const b = html.indexOf(CLOSE, a);
  const current = html.slice(a + OPEN.length, b);
  const wanted = `\n${examplesJson()}\n`;
  if (current === wanted) { console.log('embedded examples are up to date'); return; }
  if (check) {
    console.error('The examples embedded in index.html differ from tests/examples. Run: node tools/embed-examples.mjs');
    process.exit(1);
  }
  writeFileSync(INDEX, html.slice(0, a + OPEN.length) + wanted + html.slice(b));
  console.log(`embedded ${Object.keys(JSON.parse(wanted)).length} examples into index.html`);
}

main();
