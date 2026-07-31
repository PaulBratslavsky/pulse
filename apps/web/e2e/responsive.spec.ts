import { test, expect, type Page } from '@playwright/test'
import { injectMention } from './helpers'

/**
 * Responsive coverage. Runs under three device projects (iPhone/WebKit,
 * Pixel/Chromium, iPad) from one file, so the same guarantees are checked on
 * both engines — dvh and env(safe-area-inset-*) are not implemented alike.
 *
 * The load-bearing assertion is "no horizontal scroll". It's the failure users
 * actually feel (the page slides sideways, content hides off-screen) and it
 * catches a whole class of regressions — an un-truncated URL, a fixed-width
 * grid, a flex child missing min-w-0 — that no single component test would.
 */

const PAGES = ['/', '/trends', '/themes', '/feedback', '/insights', '/graph', '/chat', '/settings']

/** Horizontal overflow, measured on the real layout. 1px of tolerance absorbs
 *  sub-pixel rounding at fractional DPRs (Pixel 7 is 2.625x). */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth }
  })
}

test.describe('responsive layout', () => {
  for (const path of PAGES) {
    test(`${path} does not scroll horizontally`, async ({ page }) => {
      await page.goto(path)
      // wait for the shell, so we measure a painted page not an empty one
      await expect(page.locator('nav').first()).toBeVisible()
      const { scrollWidth, clientWidth } = await horizontalOverflow(page)
      expect(
        scrollWidth,
        `${path} overflows by ${scrollWidth - clientWidth}px`
      ).toBeLessThanOrEqual(clientWidth + 1)
    })
  }

  test('a long unbroken URL in a mention cannot widen the page', async ({ page, request }) => {
    // the classic overflow source: one very long token with no break opportunity
    const tag = `r${Date.now().toString(36)}`
    await injectMention(request, {
      text: `${tag} see https://example.com/${'x'.repeat(180)}?utm_source=${'y'.repeat(120)}`,
      timestamp: '2017-03-01 00:00:00.000',
    })
    await page.goto(`/?q=${tag}`)
    await expect(page.locator('li').filter({ hasText: tag })).toHaveCount(1)
    const { scrollWidth, clientWidth } = await horizontalOverflow(page)
    expect(scrollWidth, `overflowed by ${scrollWidth - clientWidth}px`).toBeLessThanOrEqual(
      clientWidth + 1
    )
  })

  test('the mention detail page holds its width', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByRole('button', { name: 'Claim' })).toBeVisible()
    const { scrollWidth, clientWidth } = await horizontalOverflow(page)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  })
})

test.describe('phone navigation', () => {
  // the drawer only exists under `sm` — on the iPad the sidebar is present
  // instead, so this block is phone-only
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 640, 'phone-only drawer')

  test('every destination is reachable from the drawer', async ({ page }) => {
    await page.goto('/')
    // the desktop sidebar must NOT be what is serving links here
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible()

    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect(drawer).toBeVisible()

    for (const label of ['Queue', 'Trends', 'Themes', 'Feedback', 'Insights', 'Map', 'Chat', 'Settings']) {
      await expect(drawer.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('drawer navigates, then closes itself', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Insights' }).click()

    await expect(page).toHaveURL(/\/insights/)
    // a drawer left open over the page it just navigated to is the classic bug
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible()
  })

  test('drawer closes on backdrop tap and on Escape', async ({ page }) => {
    await page.goto('/')
    const open = page.getByRole('button', { name: 'Open navigation menu' })
    const drawer = page.getByRole('dialog', { name: 'Navigation' })

    await open.click()
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()

    await open.click()
    await expect(drawer).toBeVisible()
    // tap far right of the panel — that is backdrop
    await page.mouse.click(page.viewportSize()!.width - 8, 300)
    await expect(drawer).toBeHidden()
  })

  test('primary controls meet the 44px touch-target minimum', async ({ page }) => {
    await page.goto('/')
    for (const name of ['Open navigation menu', 'Sign out']) {
      const box = await page.getByRole('button', { name }).first().boundingBox()
      expect(box, `${name} has no box`).not.toBeNull()
      expect(box!.height, `${name} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${name} is ${box!.width}px wide`).toBeGreaterThanOrEqual(44)
    }
  })

  test('no field is small enough to make iOS zoom on focus', async ({ page, request }) => {
    // Safari zooms the page in whenever a focused field is under 16px and
    // never zooms back out — it would fire on the search box, the reply
    // composer, every filter input.
    const { documentId } = await injectMention(request)
    for (const path of ['/', `/mentions/${documentId}`, '/settings']) {
      await page.goto(path)
      await expect(page.locator('nav').first()).toBeVisible()
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('input, textarea, select')]
          .filter((el) => {
            const t = (el as HTMLInputElement).type
            return t !== 'checkbox' && t !== 'radio'
          })
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            name: (el as HTMLInputElement).name || (el as HTMLInputElement).placeholder || '?',
            size: parseFloat(getComputedStyle(el).fontSize),
          }))
          .filter((f) => f.size < 16)
      )
      expect(small, `${path} has sub-16px fields: ${JSON.stringify(small)}`).toEqual([])
    }
  })

  test('queue filter pills are tappable', async ({ page }) => {
    await page.goto('/')
    const pill = page.getByRole('link', { name: 'unanswered', exact: true }).first()
    const box = await pill.boundingBox()
    expect(box).not.toBeNull()
    // 38px is the deliberate floor for pills: 44 would force the ~17-pill
    // filter block to eat the screen. Still comfortably tappable.
    expect(box!.height).toBeGreaterThanOrEqual(38)
  })
})
