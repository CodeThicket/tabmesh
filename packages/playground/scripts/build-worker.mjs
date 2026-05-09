/**
 * Bundles the SharedWorker entry from @tabmesh/core into a single IIFE
 * served at /tabmesh-worker.js. Run after touching core/src/worker/*.
 *
 * Usage: node scripts/build-worker.mjs
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const entry = resolve(root, '../core/src/worker/tabmesh-worker.ts');
const outfile = resolve(root, 'public/tabmesh-worker.js');

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
