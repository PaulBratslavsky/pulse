import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests against the real local stack:
 * - Next.js on :3000, Strapi on :1338 (start both with `npm run dev` at the repo root)
 * - Tests create their own mentions via the ingest webhook (OCTOLENS_WEBHOOK_SECRET),
 *   so they don't depend on seed state.
 * - Auth: the "setup" project signs in ONCE and saves storage state; the "app"
 *   project reuses it (per-test sign-ins trip Strapi's auth rate limit).
 *   auth.spec.ts runs in its own project WITHOUT stored state — it tests the
 *   sign-in/sign-out flows themselves.
 *
 * PW_BASE_URL points the whole suite somewhere else — a second checkout, a
 * worktree, a preview deploy. Setting it also means "a server is already
 * running", so the managed webServer stands down.
 *
 * Specs must use RELATIVE paths (`request.get('/api/pulse/...')`). They used to
 * hardcode http://localhost:3000, which silently tested whatever owned that
 * port: with an unrelated app there, every such call came back as HTML and the
 * failures read like application bugs.
 */
const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1, // flows mutate shared state (claim/respond) — keep serial
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Pure-function tests: no auth, no page, no fixtures. Deliberately has no
    // `dependencies`, so a failing sign-in cannot hide a conversion bug.
    { name: 'unit', testMatch: /(plain-text|queue-query)\.spec\.ts/ },
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'auth-flows',
      testMatch: /auth\.spec\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'app',
      testMatch: /(queue-and-detail|insights|graph|leads|mcp-servers)\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: 'playwright/.auth/dana.json' },
    },
    // Real device profiles rather than a narrow desktop window: actual
    // viewport, DPR, touch support and mobile UA, so touch-only paths and
    // `max-sm:` breakpoints are exercised the way a phone would.
    {
      name: 'mobile-android',
      testMatch: /responsive\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: 'playwright/.auth/dana.json' },
    },
    // iPhone/iPad *metrics* on Chromium. Not a substitute for WebKit, but it
    // runs everywhere and catches the whole overflow/breakpoint/tap-target
    // class at Apple viewport sizes.
    {
      name: 'mobile-ios-metrics',
      testMatch: /responsive\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
        viewport: devices['iPhone 14'].viewport,
        deviceScaleFactor: devices['iPhone 14'].deviceScaleFactor,
        storageState: 'playwright/.auth/dana.json',
      },
    },
    {
      name: 'tablet-metrics',
      testMatch: /responsive\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
        viewport: devices['iPad Mini'].viewport,
        storageState: 'playwright/.auth/dana.json',
      },
    },
    // Genuine WebKit — the only engine that reproduces Safari's dvh and
    // env(safe-area-inset-*) behaviour, so it IS worth running. Opt-in via
    // PW_WEBKIT=1 because the webkit-2336 build segfaults on launch under
    // macOS 26 (Darwin 25); enable it in CI and on machines where it works.
    ...(process.env.PW_WEBKIT
      ? [
          {
            name: 'mobile-ios-webkit',
            testMatch: /responsive\.spec\.ts/,
            dependencies: ['setup'],
            use: { ...devices['iPhone 14'], storageState: 'playwright/.auth/dana.json' },
          },
          {
            name: 'tablet-webkit',
            testMatch: /responsive\.spec\.ts/,
            dependencies: ['setup'],
            use: { ...devices['iPad Mini'], storageState: 'playwright/.auth/dana.json' },
          },
        ]
      : []),
  ],
  // PW_BASE_URL means you started the server yourself; don't also manage one.
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: `${BASE_URL}/sign-in`,
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
