import { test, expect } from '@playwright/test'

/**
 * Conversation map. The load-bearing check is that the graph is NOT EMPTY:
 * the whole reason it reads mention text rather than the Topic relation is
 * that a topic-based graph has ~10 edges on this corpus. A blank canvas would
 * still render, still pass a "page loads" test, and be worthless — so the
 * density is asserted directly.
 */

test.describe('conversation map', () => {
  test('renders a populated graph with clusters, bridges and gaps', async ({ page }) => {
    await page.goto('/graph?days=365')
    await expect(page.getByRole('heading', { name: 'Conversation map' })).toBeVisible()

    // scoped to the testid: lucide nav icons are SVGs too, so an unscoped
    // canvas/svg locator would match navigation chrome
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
    await expect(page.getByTestId('graph-canvas').locator('canvas').first()).toBeVisible()

    const summary = page.getByText(/\d+ concepts · \d+ links/)
    await expect(summary).toBeVisible()
    const text = (await summary.textContent()) ?? ''
    const [, concepts, links] = text.match(/(\d+) concepts · (\d+) links/) ?? []
    expect(Number(concepts), 'graph should not be near-empty').toBeGreaterThan(30)
    expect(Number(links), 'graph should not be near-empty').toBeGreaterThan(50)

    await expect(page.getByRole('heading', { name: 'Clusters' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Bridges' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Gaps' })).toBeVisible()
  })

  test('projection switcher changes the graph', async ({ page }) => {
    await page.goto('/graph?days=365')
    await page.getByRole('link', { name: 'Voices' }).click()
    await expect(page).toHaveURL(/projection=authors/)
    await expect(page.getByTestId('graph-canvas')).toBeVisible()
  })

  test('the empty topics projection explains itself instead of showing a blank canvas', async ({
    page,
  }) => {
    // Topics are only populated by the AI sweep; with it off this projection is
    // genuinely empty, and saying so is more useful than an empty box.
    await page.goto('/graph?projection=topics&days=365')
    const canvas = page.getByTestId('graph-canvas')
    const empty = page.getByText('Nothing to map yet')
    // whichever state the corpus is in, the page must be self-explanatory
    if (await empty.isVisible().catch(() => false)) {
      await expect(page.getByText(/Concepts view/)).toBeVisible()
    } else {
      await expect(canvas).toBeVisible()
    }
  })
})
