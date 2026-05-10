import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    // The e2e/ directory is driven by Playwright, not Vitest. Adding
    // it to the exclude list prevents `vitest` from trying to load the
    // spec files (which use `test.describe` from `@playwright/test`).
    // The other patterns are vitest's documented defaults — repeated
    // here because providing `exclude` replaces the defaults entirely.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        // Cover the publishable libraries only. The playground demo, the
        // SharedWorker script, and the Service Worker script are
        // exercised by the Playwright e2e harness — counting them at 0%
        // here would tank the global threshold without proving anything.
        'packages/core/src/**/*.ts',
        'packages/react/src/**/*.ts',
        'packages/transport-websocket/src/**/*.ts',
      ],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/tests/**',
        '**/*.config.ts',
        '**/index.ts',
        // Worker scripts run in their own global scope; covered by the
        // e2e harness (PR #14 + PR #16), not by Vitest.
        'packages/core/src/service-worker/tabmesh-sw.ts',
        'packages/core/src/worker/tabmesh-worker.ts',
      ],
      // Thresholds match the current realistic Vitest-only coverage. The
      // e2e Playwright suite exercises the elected-leader, SharedWorker
      // port lifecycle, and SW handoff paths that the unit suite can't
      // reach without a real browser. Raising these is a follow-up that
      // requires additional unit-level tests for those components.
      thresholds: {
        lines: 70,
        functions: 60,
        branches: 80,
        statements: 70,
      },
    },
  },
});
