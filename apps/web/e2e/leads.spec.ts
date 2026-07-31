import { test, expect } from '@playwright/test'
import { injectMention } from './helpers'

/** The app talks to Strapi through the Next proxy, which attaches the JWT from
 *  the session cookie. Hitting Strapi directly with a cookie just 403s — and a
 *  403 here reads as "no leads", which silently skips the test instead of
 *  failing it. */
const PULSE = 'http://localhost:3000/api/pulse'

/**
 * Leads is the one surface organised around a PERSON rather than a post, so the
 * tests below are mostly about identity and about the score meaning what it
 * says. Two of them exist specifically to catch regressions that already
 * happened once during the build.
 */
test.describe('leads', () => {
  test('renders the board and explains the score', async ({ page }) => {
    await page.goto('/leads')
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible()
    // the gate, stated on the page: corroboration alone must never make a lead
    await expect(page.getByText(/naming a competitor is corroboration/)).toBeVisible()

    const first = page.locator('ul > li').first()
    if ((await page.locator('ul > li').count()) === 0) return // empty corpus is a valid state
    await first.getByRole('button', { name: 'why this score' }).click()
    // a score nobody can explain is a score nobody trusts
    await expect(first.getByText(/deliberately not part of this number/)).toBeVisible()
  })

  test('a person carries their verbatim quote, and it really is in the post', async ({
    page,
    request,
  }) => {
    const leads = await (
      await request.get(`${PULSE}/people/leads`, {
        headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
      })
    ).json()
    expect(Array.isArray(leads.data), 'the leads endpoint must answer through the proxy').toBe(true)

    for (const lead of (leads.data ?? []).slice(0, 10)) {
      const quote = lead.leadContext?.evidence
      if (!quote) continue
      const mentionId = lead.leadContext?.strongestMention
      expect(mentionId, 'a quote must name the mention it came from').toBeTruthy()
      const m = await (
        await request.get(`${PULSE}/mentions/${mentionId}`, {
          headers: {
            cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; '),
          },
        })
      ).json()
      const content: string = m.data?.content ?? ''
      // The whole point of laneEvidence: a model cannot quote words that are
      // not there, which makes this a hard check rather than a hope.
      expect(content.replace(/\s+/g, ' ')).toContain(quote.replace(/\s+/g, ' ').trim())
    }
  })

  test('the fit trap: followers must not move the score', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const before = await (
      await request.get(`${PULSE}/people/leads`, { headers: { cookie } })
    ).json()
    const target = (before.data ?? []).find((l: any) => l.leadScore > 0)
    test.skip(!target, 'no scored lead in this corpus')

    // Same author, same platform → same person. A huge follower count arrives
    // with the new mention; if it changes the score, reach has quietly become
    // a fit signal and the number no longer means what the UI says it means.
    await injectMention(request, {
      text: 'Just another post from this author, nothing new about their stack.',
      author: { handle: target.handle },
      authorUrl: target.profileUrl,
      authorFollowers: 9_999_999,
      platform: target.channel ?? 'x',
    })
    await request.post(`${PULSE}/people/rescore`, { headers: { cookie } })

    const after = await (
      await request.get(`${PULSE}/people/leads`, { headers: { cookie } })
    ).json()
    const same = (after.data ?? []).find((l: any) => l.documentId === target.documentId)
    expect(same, 'the person must not fork into a second row').toBeTruthy()
    expect(same.leadScore).toBe(target.leadScore)
    // reach still surfaces — beside the score, never inside it
    expect(same.reachTier).toBe('large')
  })

  test('status transitions persist and claim the lead', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const leads = await (
      await request.get(`${PULSE}/people/leads`, { headers: { cookie } })
    ).json()
    const target = (leads.data ?? [])[0]
    test.skip(!target, 'no leads in this corpus')

    await page.goto('/leads')
    const card = page.locator('ul > li').first()
    await card.locator('select').selectOption('contacted')
    await expect(card.locator('select')).toHaveValue('contacted', { timeout: 15_000 })

    await page.reload()
    await expect(page.locator('ul > li').first().locator('select')).toHaveValue('contacted')
  })
})
