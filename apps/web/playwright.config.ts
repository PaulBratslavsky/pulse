import { defineConfig } from '@playwright/test'

/**
 * E2E tests against the real local stack:
 * - Next.js on :3000, Strapi on :1337 (start both with `npm run dev` at the repo root)
 * - Tests create their own mentions via the ingest webhook (OCTOLENS_WEBHOOK_SECRET),
 *   so they don't depend on seed state.
 * - Auth: the "setup" project signs in ONCE and saves storage state; the "app"
 *   project reuses it (per-test sign-ins trip Strapi's auth rate limit).
 *   auth.spec.ts runs in its own project WITHOUT stored state — it tests the
 *   sign-in/sign-out flows themselves.
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
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'auth-flows',
      testMatch: /auth\.spec\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'app',
      testMatch: /(queue-and-detail|insights)\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: 'playwright/.auth/dana.json' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/sign-in',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
