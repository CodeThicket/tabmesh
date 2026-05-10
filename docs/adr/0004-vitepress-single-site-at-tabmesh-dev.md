# Single VitePress site at tabmesh.dev for docs, roadmap, and playground

The TabMesh public surface (landing, guides, API reference, ADRs, roadmap, and the interactive playground) lives in a single VitePress site deployed to `tabmesh.dev` via Vercel. The current React playground (`packages/playground`) is embedded as an iframe inside a `/playground` route rather than re-implemented as a VitePress component, which keeps the existing Playwright e2e suite pointed at an unchanged target.

We chose VitePress over Docusaurus, Nextra, and Mintlify because it shares the Vite/TypeScript stack already used everywhere else in the repo, has zero per-page hosting cost, and gives the same single-domain navigation experience that Vite, Vitest, and Vue's own sites use.

## Considered Options

- **VitePress, single site, iframe playground (chosen)**: One Vercel deploy, one repo, sidebar nav covers docs/roadmap/playground uniformly. Iframe means the playground stays a separate Vite app that tests can drive directly.
- **Docusaurus**: more popular and React-native, but heavier (Webpack-based vs Vite-based), and pulling in a React docs framework when our playground happens to be React but the rest of the repo is build-tool-agnostic feels arbitrary. Plugin ecosystem is broader, which we don't currently need.
- **Mintlify**: best out-of-the-box design and search. Hosted SaaS — gives up ownership of the deploy pipeline and the content lives in their format. Vendor lock-in is the main reason to skip for an OSS library.
- **Nextra (Next.js + MDX)**: solid choice for MDX-first docs. Adds a Next.js dependency we wouldn't otherwise need. Probably overkill for the size of the docs.
- **Two deploys (docs at root, playground at app.tabmesh.dev)**: avoids the iframe but doubles the deploy pipeline and breaks unified search/navigation. Net negative.

## Consequences

- The docs source lives in `docs/` (which already exists for ADRs). VitePress reads this directory; ADRs become a site section automatically rather than internal-only.
- Custom components in the docs site (interactive examples beyond the playground) must be Vue-flavored, since VitePress is Vue under the hood. For a small library this is fine; if we later want richer interactive content we'd evaluate the migration cost again.
- The playground iframe means cross-frame `postMessage` is the only escape hatch if the docs site ever needs to talk to the playground (e.g., "click here to load this todo into the playground"). Not currently planned.
- Vercel deploy is configured at the repo root; build command runs the docs build (`pnpm --filter ./docs build` or similar) plus the playground's existing build. Both static-asset directories are merged at deploy time.
