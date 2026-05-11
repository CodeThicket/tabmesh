#!/usr/bin/env node
/**
 * Release helper. Bumps all three publishable @tabmesh/* package.json
 * versions in lockstep, keeps their peer-dependency on @tabmesh/core
 * pinned to the same version, and tags the result.
 *
 * Usage:
 *   node scripts/release.mjs 0.1.0-alpha.0
 *
 * Then push the tag to trigger .github/workflows/publish.yml:
 *   git push origin main --tags
 *
 * The workflow re-validates that the tag matches the three package
 * versions, then publishes via npm trusted publishing (OIDC, no
 * NPM_TOKEN). The dist-tag is inferred from the version suffix:
 *   x.y.z-alpha.n -> alpha
 *   x.y.z-beta.n  -> beta
 *   x.y.z-rc.n    -> next
 *   x.y.z         -> latest
 *
 * Idempotency: re-running with the same version is a no-op for files
 * but will fail at `git commit` (nothing to commit) and `git tag`
 * (tag exists). That's intentional.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/.test(version)) {
  console.error('Usage: node scripts/release.mjs <semver>');
  console.error('Examples: 0.1.0-alpha.0, 0.1.0-beta.1, 0.1.0, 1.0.0-rc.0');
  process.exit(1);
}

const packages = [
  { name: '@tabmesh/core', dir: 'packages/core', peerOfCore: false },
  { name: '@tabmesh/react', dir: 'packages/react', peerOfCore: true },
  {
    name: '@tabmesh/transport-websocket',
    dir: 'packages/transport-websocket',
    peerOfCore: true,
  },
];

for (const pkg of packages) {
  const path = resolve(pkg.dir, 'package.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  // Pin the peer-dep on @tabmesh/core to the exact version so consumers
  // can't end up with a mixed-version install. We're pre-1.0; protocol
  // changes between alphas should force an all-three upgrade.
  if (pkg.peerOfCore && json.peerDependencies?.['@tabmesh/core']) {
    json.peerDependencies['@tabmesh/core'] = version;
  }
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`bumped ${pkg.name} → ${version}`);
}

// Commit and tag in one shot. Don't push — that's intentional, gives a
// chance to review `git show` before the publish workflow fires.
execSync(`git add ${packages.map((p) => `${p.dir}/package.json`).join(' ')}`);
execSync(`git commit -m "chore(release): v${version}"`);
execSync(`git tag v${version}`);

console.log('');
console.log(`Tagged v${version}. To publish, push the tag:`);
console.log('  git push origin main --tags');
console.log('');
console.log('The publish workflow will:');
console.log(`  1. Verify tag v${version} matches all three package versions`);
console.log('  2. Build all packages');
console.log('  3. Run unit tests');
console.log(
  `  4. Publish all three with --tag ${version.includes('-alpha.') ? 'alpha' : version.includes('-beta.') ? 'beta' : version.includes('-rc.') || version.includes('-next.') ? 'next' : 'latest'} (inferred from suffix)`
);
console.log('  5. Each publish carries npm provenance (OIDC trusted publishing)');
