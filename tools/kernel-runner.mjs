// NEXUS-4 kernel runner: loads the simulator kernel straight out of index.html
// and runs it in a Node vm context. There is no build step: the kernel exists
// only inside <script id="nexus4-kernel"> in index.html (decision D1 / D28).

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Extracts the source of <script id="nexus4-kernel"> from index.html. */
export function extractKernelSource(indexPath) {
  const html = readFileSync(indexPath, 'utf8');
  const m = /<script\b[^>]*\bid="nexus4-kernel"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) throw new Error(`${indexPath}: no <script id="nexus4-kernel"> found`);
  return m[1];
}

/** Evaluates the kernel in an isolated context and returns its public object (window.NEXUS4.kernel). */
export function loadKernel(indexPath) {
  const source = extractKernelSource(indexPath);
  const sandbox = { console, BigInt };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'index.html#nexus4-kernel' });
  const kernel = sandbox.NEXUS4?.kernel;
  if (!kernel) throw new Error('The kernel script did not define window.NEXUS4.kernel');
  return kernel;
}

/**
 * Runs one example through our kernel.
 * The kernel contract: kernel.simulate({ source, top, stop }) returns
 * { snapshots: [{ time, delta, resumed, signals: { name: { val, active, event } } }], reports: [...] }
 * in the same shape as tools/oracle.mjs, plus `resumed`: the number of processes that resumed
 * in that cycle (used for the observable projection, decision D31). Until the kernel is implemented,
 * kernel.implemented is false and this returns null.
 */
export function runKernel(kernel, meta, source) {
  if (!kernel.implemented) return null;
  return kernel.simulate({ source, top: meta.top, stop: meta.stop });
}
