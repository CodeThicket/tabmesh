import { defineConfig, devices } from '@playwright/test';

const PLAYGROUND_URL = process.env.PLAYWRIGHT_PLAYGROUND_URL ?? 'http://localhost:5173';
const ECHO_PORT = Number(process.env.PLAYWRIGHT_ECHO_PORT ?? '8095');

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
      command:
        'pnpm --filter @tabmesh/playground build:worker && pnpm --filter @tabmesh/playground dev',
      url: PLAYGROUND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @tabmesh/playground exec node scripts/echo-server.mjs ${ECHO_PORT}`,
      port: ECHO_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
