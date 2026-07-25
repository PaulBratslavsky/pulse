import { test, expect } from '@playwright/test'
import { signIn, injectMention } from './helpers'

test.describe('queue → claim → respond → outcome (the core loop)', () => {
  test('webhook-injected mention appears in the queue and walks the full loop', async ({
    page,
    request,
  }) => {
    const { externalId } = await injectMention(request)
    await signIn(page)

    // the fresh mention is in the queue (unanalyzed yet — badge shows unscored)
    const card = page.locator('li', { hasText: externalId })
    await expect(card).toBeVisible()

    // open detail
    await card.getByRole('link', { name: 'Open' }).click()
    await expect(page.getByText(externalId)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
    await expect(page.getByText('ingested')).toBeVisible()

    // claim
    await page.getByRole('button', { name: 'Claim' }).click()
    await expect(page.getByText('claimed', { exact: true }).first()).toBeVisible()

    // record a response
    await page.getByPlaceholder('What you actually replied…').fill('E2E reply — thanks, fixed!')
    await page.getByPlaceholder('Internal notes (optional)').fill('e2e note')
    await page.getByRole('button', { name: 'Record response' }).click()
    await expect(page.getByText('E2E reply — thanks, fixed!')).toBeVisible()
    await expect(page.getByText('outcome: not recorded').first()).toBeVisible()

    // record outcome → resolved
    await page.getByRole('button', { name: 'resolved', exact: true }).click()
    await expect(page.getByText('resolved', { exact: true }).first()).toBeVisible()
  })

  test('correction controls set human-corrected label', async ({ page, request }) => {
    const { externalId } = await injectMention(request)
    await signIn(page)
    await page.locator('li', { hasText: externalId }).getByRole('link', { name: 'Open' }).click()

    // label depends on the AI feature flag: "Correct analysis" (on) / "Set sentiment / topics" (off)
    await page.getByRole('button', { name: /correct analysis|set sentiment/i }).click()
    await page.getByRole('radio').nth(2).check() // negative
    await page.getByRole('button', { name: 'Save correction' }).click()
    await expect(page.getByText('human-corrected')).toBeVisible()
    await expect(page.getByText('corrected', { exact: true })).toBeVisible() // activity entry
  })

  test('search finds recorded responses', async ({ page }) => {
    await signIn(page)
    await page.getByPlaceholder('Search mentions & past responses…').fill('uninstall')
    await expect(page.locator('a', { hasText: 'reply' }).first()).toBeVisible()
  })
})
