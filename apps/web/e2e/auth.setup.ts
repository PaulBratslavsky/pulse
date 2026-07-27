import { test as setup, expect } from '@playwright/test'
import { DANA } from './helpers'

/**
 * Signs in ONCE and saves the session (httpOnly pulse_jwt cookie) as storage
 * state for the whole "app" project. Per-test sign-ins tripped Strapi's
 * auth rate limit ("Too many requests") — the classic Playwright auth pattern
 * avoids that and makes the suite faster.
 */
setup('authenticate as dana', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByPlaceholder('Email or username').fill(DANA.identifier)
  await page.getByPlaceholder('Password').fill(DANA.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible({ timeout: 30_000 })
  await page.context().storageState({ path: 'playwright/.auth/dana.json' })
})
