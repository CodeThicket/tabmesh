/**
 * Bundles the Service Worker entry from @tabmesh/core into a single IIFE
 * served at /tabmesh-sw.js. Run after touching core/src/service-worker/*.
 *
 * Usage: node scripts/build-sw.mjs
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const entry = resolve(root, '../core/src/service-worker/tabmesh-sw.ts');
const outfile = resolve(root, 'public/tabmesh-sw.js');

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
