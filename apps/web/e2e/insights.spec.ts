import { test, expect } from '@playwright/test'
import { signIn } from './helpers'

test.describe('insights surfaces', () => {
  test('trends renders the Pulse score and chart', async ({ page }) => {
    await signIn(page)
    await page.goto('/trends')
    await expect(page.getByText('current Pulse score')).toBeVisible()
    // seeded data → a real number, not the em dash
    await expect(page.locator('.text-4xl')).not.toHaveText('—')
    await expect(page.locator('svg polyline')).toBeVisible()
  })

  test('themes ranks recurring topics', async ({ page }) => {
    await signIn(page)
    await page.goto('/themes')
    await expect(page.getByText(/ranked by volume × negativity/)).toBeVisible()
    await expect(page.locator('li', { hasText: 'mentions' }).first()).toBeVisible()
  })

  test('chat answers from the data (keyless fallback ok)', async ({ page }) => {
    await signIn(page)
    await page.goto('/chat')
    await page.getByPlaceholder('Ask Pulse…').fill('what are the top negative themes?')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText(/Pulse score:|Top themes/i).first()).toBeVisible({ timeout: 15_000 })
  })
})
