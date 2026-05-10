import { defineConfig, devices } from '@playwright/test';

const PLAYGROUND_URL = process.env.PLAYWRIGHT_PLAYGROUND_URL ?? 'http://localhost:5173';
const ECHO_PORT = Number(process.env.PLAYWRIGHT_ECHO_PORT ?? '8095');
const DELIVERY_PORT = Number(process.env.PLAYWRIGHT_DELIVERY_PORT ?? '8096');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `${PLAYGROUND_URL}/?ws=ws://localhost:${ECHO_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Core's `dist/` is what `@tabmesh/core` resolves to when Vite
      // dev-serves the playground; without it, the playground bundle
      // fails to import. Build core, then the worker + SW bundles, then
      // start vite dev.
      command:
        'pnpm --filter @tabmesh/core build && pnpm --filter @tabmesh/playground build:worker && pnpm --filter @tabmesh/playground build:sw && pnpm --filter @tabmesh/playground dev',
      url: PLAYGROUND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @tabmesh/playground exec node scripts/echo-server.mjs ${ECHO_PORT}`,
      port: ECHO_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: `node e2e/fixtures/delivery-server.mjs ${DELIVERY_PORT}`,
      port: DELIVERY_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
