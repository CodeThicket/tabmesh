/**
 * Copies the pre-built Service Worker bundle from `@tabmesh/core` into
 * the playground's `public/`. The actual bundling lives in
 * `packages/core/scripts/build-bundles.mjs` so the playground and external
 * consumers pull from the same source of truth.
 *
 * Usage: node scripts/build-sw.mjs
 *
 * Requires `@tabmesh/core` to be built first.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, '../core/dist/tabmesh-sw.js');
const dest = resolve(root, 'public/tabmesh-sw.js');

if (!existsSync(src)) {
  console.error(`[build-sw] Missing ${src}. Run \`pnpm --filter @tabmesh/core build\` first.`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`[build-sw] copied ${src} → ${dest}`);
