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
      // The playground imports @tabmesh/core, @tabmesh/react, and
      // @tabmesh/transport-websocket via their built `dist/` (per the
      // package.json `exports` field). On a fresh CI runner those
      // don't exist yet, so Vite fails to resolve the imports.
      // `^...` builds every workspace dep of the playground
      // transitively before we start the dev server. Then build the
      // worker/SW bundles and start vite dev.
      command:
        'pnpm --filter "@tabmesh/playground^..." build && pnpm --filter @tabmesh/playground build:worker && pnpm --filter @tabmesh/playground build:sw && pnpm --filter @tabmesh/playground dev',
      url: PLAYGROUND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
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
