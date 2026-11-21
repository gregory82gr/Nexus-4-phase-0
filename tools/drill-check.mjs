// The fault drills of the Drills page (D57), checked by running them: the VHDL core on the NEXUS-4
// kernel, with and without each drill's upset, judged by the page's own classifier (NEXUS4.faults).
//   - a prediction: its outcome must be one of the drill's choices (the answer is printed, not stored);
//   - a hunt: it must have a solution among the upsets the page offers (a witness, kept here and not
//     in the page, must meet the goal).
// Usage: node tools/drill-check.mjs
import { join } from 'node:path';
import { ROOT, read, loadNexus, rtlFiles, programPackage, designSource } from './core-sim.mjs';
import { loadKernel } from './kernel-runner.mjs';

const INDEX = join(ROOT, 'index.html');
const N4 = loadNexus(INDEX);
const F = N4.faults;
const kernel = loadKernel(INDEX);
const RTL = rtlFiles();

// a solution for each hunt, found by search and kept here so that the page gives nothing away
const WITNESS = {
  'h-base-sdc': { target: 'dmem', idx: 0, bit: 5, cycle: 10 },
  'h-base-hang': { target: 'imem', idx: 31, bit: 2, cycle: 3 },
  'h-plant-parity': { target: 'dmem', idx: 0, bit: 5, cycle: 10 },
  'h-plant-lockstep': { target: 'reg', idx: 18, bit: 4, cycle: 20 },
  'h-orbit-recover': { target: 'reg2', idx: 18, bit: 4, cycle: 20 },
  'h-orbit-stop': { target: 'dmem2', idx: 0, bit: 5, cycle: 10 }
};

const systems = new Map();
function system(sample, profile) {
  const key = `${sample}|${profile}`;
  if (!systems.has(key)) {
    const prog = N4.asm.assemble(read(join(ROOT, 'tests', sample)));
    if (!prog.ok) throw new Error(`${sample}: ${prog.errors[0].message}`);
    const pkg = programPackage(prog, F.setup(sample, profile));
    const src = designSource(RTL, pkg);
    const gold = runOn(src);
    systems.set(key, { src, gold });
  }
  return systems.get(key);
}
function runOn(src, fault) {
  const res = kernel.simulate({ source: src, top: 'tb_nexus4', stop: `${10 * F.MAX_CYCLES + 30}ns`, snapshots: false, log: false, faults: F.faultsOf(fault) });
  return { rep: F.reportsOf(res), applied: !!(res.faults && res.faults[0] && res.faults[0].applied) };
}
function judge(d, upset) {
  const sys = system(d.sample, d.profile);
  const fault = F.spec(upset);
  const r = runOn(sys.src, fault);
  if (!r.applied) throw new Error(`${d.id}: the upset was never applied (after the end of the program?)`);
  return F.classify({ profile: d.profile, gold: sys.gold.rep, run: r.rep, faultCycle: fault.cycle, maxCycles: F.MAX_CYCLES });
}

let checks = 0, failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const t0 = Date.now();
for (const d of F.DRILLS) {
  checks++;
  try {
    if (!F.TARGETS.length || !F.CHOICES[d.profile]) throw new Error('no choices for its profile');
    const offered = (t) => { const x = F.TARGETS.find((y) => y.id === t); return x && (!x.profile || x.profile.includes(d.profile)); };
    if (d.kind === 'predict') {
      if (!offered(d.upset.target)) throw new Error(`the page does not offer ${d.upset.target} in ${F.PROFILES[d.profile]}`);
      const r = judge(d, d.upset);
      const key = F.keyOf(r);
      if (!F.CHOICES[d.profile].some(([k]) => k === key)) fail(`${d.id}: the outcome ${key} is not one of its choices`);
      else console.log(`ok    ${d.id.padEnd(18)} ${F.PROFILES[d.profile].padEnd(5)}  ${key}${r.latency !== undefined ? ` (${r.latency} cycles)` : ''} · ${r.why}`);
    } else {
      const w = WITNESS[d.id];
      if (!w) throw new Error('no witness');
      if (!offered(w.target)) throw new Error(`its witness uses ${w.target}, which the page does not offer in ${F.PROFILES[d.profile]}`);
      const r = judge(d, w);
      if (!F.goalMet(d.goal, r)) fail(`${d.id}: the witness gives ${F.keyOf(r)}, not the goal`);
      else console.log(`ok    ${d.id.padEnd(18)} ${F.PROFILES[d.profile].padEnd(5)}  solvable: ${F.keyOf(r)}`);
    }
  } catch (e) { fail(`${d.id}: ${e.message}`); }
}
console.log(`\n${checks} drills, ${failures} failed (${((Date.now() - t0) / 1000).toFixed(0)} s).`);
process.exit(failures ? 1 : 0);
