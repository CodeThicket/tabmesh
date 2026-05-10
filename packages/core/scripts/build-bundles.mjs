/**
 * Bundles the SharedWorker and Service Worker entry points into single-file
 * IIFEs that ship as part of `@tabmesh/core`'s `dist/`. Consumers copy these
 * files to their app's static-asset directory (e.g. `public/`) and point
 * TabMesh's `workerUrl` / `serviceWorker.scriptUrl` at the served paths.
 *
 * Usage: node scripts/build-bundles.mjs
 *
 * Why bundled IIFEs and not ESM:
 * - SharedWorker / ServiceWorker constructors accept a script URL. The
 *   browser fetches and parses that script; ESM imports inside it would
 *   require classic-vs-module worker types that vary across environments.
 *   IIFE is the simplest format that "just works" everywhere.
 *
 * See: docs/adr/0003-distribute-prebuilt-worker-bundles.md
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const targets = [
  {
    entry: resolve(root, 'src/worker/tabmesh-worker.ts'),
    outfile: resolve(root, 'dist/tabmesh-worker.js'),
  },
  {
    entry: resolve(root, 'src/service-worker/tabmesh-sw.ts'),
    outfile: resolve(root, 'dist/tabmesh-sw.js'),
  },
];

await Promise.all(
  targets.map((t) =>
    build({
      entryPoints: [t.entry],
      bundle: true,
      format: 'iife',
      target: 'es2020',
      outfile: t.outfile,
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'info',
    })
  )
);
