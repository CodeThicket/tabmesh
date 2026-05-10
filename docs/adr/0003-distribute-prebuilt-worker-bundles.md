# Distribute pre-built worker bundles inside `@tabmesh/core`

`@tabmesh/core` ships a pre-built `dist/worker.js` (the SharedWorker entry) and `dist/sw.js` (the Service Worker entry) alongside its library code. Consumers copy these files to their app's static-asset directory and TabMesh's `workerUrl` / `serviceWorker.scriptUrl` config points at the served paths. The README documents the one-line copy step for Vite, Webpack, and Next.

We chose this over a Vite plugin or runtime Blob-URL inlining because pre-built files + a documented copy step is the lowest-friction option that works in every bundler and respects strict Content Security Policies.

## Considered Options

- **Pre-built bundles in `dist/` (chosen)**: Works in any bundler. CSP-friendly (served from the app origin). One manual copy step.
- **`@tabmesh/vite-plugin`**: Best DX for the ~70% of users on Vite. But adds a package to maintain and doesn't help Webpack / Next / esbuild / Rollup users — who would still need the manual path. We would also still need to ship the pre-built file for the plugin to copy.
- **Runtime Blob URL**: Bundle the worker source as a string and `URL.createObjectURL(new Blob([...]))` at runtime. Zero copy steps. But strict CSPs reject `blob:` worker sources, and `SharedWorker` from a Blob URL has spec edge cases (named workers across tabs may not coalesce reliably).

## Consequences

- The `dist/` layout for `@tabmesh/core` becomes part of the public contract. Renaming `dist/worker.js` is a breaking change.
- Users who upgrade `@tabmesh/core` to a version with a worker-protocol change must remember to re-copy the file. The `workerVersion` config (PR #11) makes this less catastrophic — old tabs talk to the old worker until reload.
- Build pipeline must run the worker/SW esbuild steps before `vite build` of the core package, and the resulting files must be included in `files` in `package.json`.
- A future Vite plugin can layer on top of this without breaking changes — it would just copy the same pre-built files.
