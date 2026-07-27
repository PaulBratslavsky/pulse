import { test, expect } from '@playwright/test'


test.describe('insights surfaces', () => {
  test('trends renders the Pulse score and chart', async ({ page }) => {
    await page.goto('/trends')
    await expect(page.getByText('current Pulse score')).toBeVisible()
    // seeded data → a real number, not the em dash
    await expect(page.locator('.text-4xl')).not.toHaveText('—')
    await expect(page.locator('svg polyline')).toBeVisible()
  })

  test('themes ranks recurring topics', async ({ page }) => {
    await page.goto('/themes')
    await expect(page.getByText(/ranked by volume × negativity/)).toBeVisible()
    await expect(page.locator('li', { hasText: 'mentions' }).first()).toBeVisible()
  })

  test('chat works when AI is enabled, shows disabled notice when not', async ({ page, request }) => {
    const config = await (
      await request.get('http://localhost:3000/api/pulse/insights/config', {
        headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
      })
    ).json()

    await page.goto('/chat')
    if (config.data.aiEnabled) {
      await page.getByPlaceholder('Ask Pulse…').fill('what are the top negative themes?')
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(page.locator('.whitespace-pre-wrap').nth(1)).toBeVisible({ timeout: 20_000 })
    } else {
      await expect(page.getByText('AI features are disabled')).toBeVisible()
      await expect(page.getByPlaceholder('Ask Pulse…')).toHaveCount(0)
    }
  })

  test('draft button hidden and manual labeling offered when AI is disabled', async ({ page, request }) => {
    await page.goto('/')
    const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const config = await (
      await request.get('http://localhost:3000/api/pulse/insights/config', { headers: { cookie: cookies } })
    ).json()
    test.skip(config.data.aiEnabled, 'AI enabled — draft button is expected to be visible')

    await page.locator('li').filter({ hasText: 'Open' }).first().getByRole('link', { name: 'Open' }).click()
    await expect(page.getByRole('button', { name: /generate docs-grounded draft/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Set sentiment / topics' })).toBeVisible()
  })
})
