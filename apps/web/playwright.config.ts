import { defineConfig } from '@playwright/test'

/**
 * E2E tests against the real local stack:
 * - Next.js on :3000, Strapi on :1337 (start both before running — `npm run dev:cms` / `dev:web`)
 * - Tests create their own mentions via the ingest webhook (OCTOLENS_WEBHOOK_SECRET),
 *   so they don't depend on seed state.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1, // flows mutate shared state (claim/respond) — keep serial
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/sign-in',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
