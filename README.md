# TabMesh

> Frontend event mesh for cross-tab coordination. **Like Istio for the frontend.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚧 Work in Progress

TabMesh is currently under active development. This repository contains the initial project setup.

## What is TabMesh?

TabMesh brings service mesh principles to the frontend, providing:

- 🔄 **Cross-tab event coordination** - Sync state across all browser tabs
- 👑 **Leader election** - One tab manages shared resources
- 🔌 **Shared backend connections** - 1 WebSocket for N tabs (80% reduction!)
- 💾 **Offline event queue** - Works offline, syncs when online
- 🐛 **Event debugging** - Timeline, export, replay for production debugging
- ⚡ **Zero configuration** - Works out of the box

## Project Structure

```
tabmesh/
├── packages/
│   └── core/          # @tabmesh/core - Main SDK (coming soon)
└── docs/              # Documentation (coming soon)
```

## Development

This is a pnpm workspace monorepo. To get started:

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Lint & format
pnpm biome:check
```

## Tooling

- **Build**: Vite + TypeScript
- **Test**: Vitest
- **Lint/Format**: Biome (faster alternative to ESLint + Prettier)
- **Package Manager**: pnpm (workspace support)

## License

MIT © TabMesh Contributors

## Status

- [x] Project setup and configuration
- [ ] CI/CD pipelines
- [ ] Core types
- [ ] Event bus implementation
- [ ] Leader election
- [ ] Transport layer
- [ ] Framework integrations
- [ ] Documentation
