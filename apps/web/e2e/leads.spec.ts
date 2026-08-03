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

  test('a card opens the person, showing their history and taking notes', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const leads = await (await request.get(`${PULSE}/people/leads`, { headers: { cookie } })).json()
    test.skip(!(leads.data ?? []).length, 'no leads in this corpus')

    await page.goto('/leads')
    // the person's name is the real, announced link (the card overlay is
    // aria-hidden and mouse-only)
    const name = (leads.data[0].displayName ?? `@${leads.data[0].handle}`) as string
    await page.getByRole('link', { name, exact: true }).first().click()
    await expect(page).toHaveURL(/\/leads\/[a-z0-9]+/)

    await expect(page.getByRole('heading', { name: 'Conversation history' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Notes & activity' })).toBeVisible()
    // the score is explained on the page, not just asserted
    // collapsed by default: the score is visible, the breakdown is not
    await expect(page.getByText('Why this score')).toBeVisible()
    await expect(page.getByText('none of it is part of the score')).toBeHidden()
    await page.getByText('Context', { exact: true }).click()
    await expect(page.getByText('none of it is part of the score')).toBeVisible()

    const note = `e2e note ${Date.now()}`
    // 'Note (with resources)' is the KIND CHIP; 'Add note' is the submit.
    // A loose /^comment/i regex matched the Comment chip instead and silently
    // switched the kind back rather than posting anything.
    await page.getByRole('button', { name: 'Note (with resources)' }).click()
    await page.locator('textarea').fill(note)
    await page.getByRole('button', { name: 'Add note', exact: true }).click()
    await expect(page.getByText(note)).toBeVisible({ timeout: 15_000 })

    // survives a reload — it is stored against the person, not the page
    await page.reload()
    await expect(page.getByText(note)).toBeVisible()
  })

  test('changing status on a card does not navigate away', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const leads = await (await request.get(`${PULSE}/people/leads`, { headers: { cookie } })).json()
    test.skip(!(leads.data ?? []).length, 'no leads in this corpus')

    await page.goto('/leads')
    // the quote must stay selectable despite the card-wide link overlay
    await expect(page.locator('ul > li blockquote').first()).toHaveClass(/select-text/)
    await page.locator('ul > li').first().locator('select').selectOption('watching')
    await page.waitForTimeout(1500)
    // the whole card is a link overlay; a select that navigates on change would
    // make the status control unusable
    await expect(page).toHaveURL(/\/leads$/)
  })

  test('re-selecting the same status is not logged as a transition', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const leads = await (await request.get(`${PULSE}/people/leads`, { headers: { cookie } })).json()
    const target = (leads.data ?? [])[0]
    test.skip(!target, 'no leads in this corpus')

    const trail = async () => {
      const d = await (await request.get(`${PULSE}/people/${target.documentId}`, { headers: { cookie } })).json()
      return (d.data.activities ?? []).length
    }
    await request.post(`${PULSE}/people/${target.documentId}/status`, {
      headers: { cookie },
      data: { status: 'watching' },
    })
    const before = await trail()
    // same value again — a no-op, and the timeline must not grow
    await request.post(`${PULSE}/people/${target.documentId}/status`, {
      headers: { cookie },
      data: { status: 'watching' },
    })
    expect(await trail()).toBe(before)
  })

  /**
   * Routing used to be correctable only by an agent (pulse-set-lane), and the
   * board only moved when someone POSTed /people/rescore by hand — which
   * nothing in the app did. So a human who spotted a missed lead had no way to
   * capture it. This walks the whole path: route it, and the person appears.
   */
  test('a human can route a mention into the lead lane, and the board picks it up', async ({
    page,
    request,
  }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const handle = `e2e_router_${Date.now().toString(36)}`
    // Deliberately NOT lead-shaped: no switching phrasing for the ingest regex
    // to catch, so the lane below is the human's doing and nothing else's.
    const { documentId } = await injectMention(request, {
      text: 'We run a few client sites on Webflow and I keep an eye on what else is out there.',
      author: { handle },
    })

    const board = async () =>
      (await (await request.get(`${PULSE}/people/leads`, { headers: { cookie } })).json()).data ?? []
    expect(
      (await board()).find((l: any) => l.handle === handle),
      'must not be a lead before a human says so'
    ).toBeFalsy()

    await page.goto(`/mentions/${documentId}`)
    await page.getByRole('button', { name: /correct analysis|set sentiment/i }).click()
    await page.getByRole('radio', { name: /lead — choosing/ }).check()
    await page.getByRole('button', { name: 'Save correction' }).click()
    await expect(page.getByText('human-corrected')).toBeVisible()

    const lead = (await board()).find((l: any) => l.handle === handle)
    expect(lead, 'routing to the lead lane must score the author').toBeTruthy()
    expect(lead.leadScore).toBeGreaterThan(0)
    // The asymmetry that keeps the score honest: the 50-point signal is a quote
    // verified against the post, and only classification can produce one. A
    // hand-routed lead is real, but it is never 'hot'.
    expect(lead.leadBand).not.toBe('hot')
    expect(lead.leadContext?.evidence ?? null).toBeNull()
  })

  /**
   * The board drifts out of date by doing nothing — intent decays with the age
   * of the post, but a score is only written when something touches that
   * person. So "when was this last computed" is not a detail, it is the whole
   * reason the panel exists.
   */
  test('lead scoring reports its own freshness and can be rescored from Settings', async ({
    page,
  }) => {
    await page.goto('/settings')
    const card = page.locator('div').filter({ hasText: /^Lead scoring/ }).first()
    await expect(page.getByRole('heading', { name: 'Lead scoring' })).toBeVisible()
    // it must not read as a metered action — that is why it is not in the
    // classification card, which shows a token budget
    await expect(card.getByText(/no model call, no tokens/)).toBeVisible()

    await page.getByRole('button', { name: 'Rescore leads' }).click()
    await expect(card.getByText('under an hour ago')).toBeVisible({ timeout: 20_000 })
  })

  /**
   * The same account used to become two people. A post with no profile URL is
   * keyed `channel:handle`; one WITH a URL is keyed by the URL. ensure()
   * reconciled those only when the handle-keyed sighting came second — so when
   * it came first, the next sighting forked a second person and both halves
   * scored below the bar the whole would clear.
   */
  test('one author posting with and without a profile URL stays one person', async ({
    page,
    request,
  }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const handle = `e2e_split_${Date.now().toString(36)}`

    // handle-keyed FIRST — the order that used to fork
    await injectMention(request, {
      text: 'Looking at headless options for a rebuild, no strong opinions yet.',
      author: { handle },
      authorUrl: null,
      platform: 'x',
    })
    // ...then the same account with the profile URL that keys it firmly
    const { documentId } = await injectMention(request, {
      text: 'Following up on the rebuild — pricing is the sticking point.',
      author: { handle },
      authorUrl: `https://x.com/${handle}`,
      platform: 'x',
    })

    const m = await (
      await request.get(`${PULSE}/mentions/${documentId}`, { headers: { cookie } })
    ).json()
    const personId = m.data?.person?.documentId
    expect(personId, 'the second mention must resolve to a person').toBeTruthy()

    const person = await (
      await request.get(`${PULSE}/people/${personId}`, { headers: { cookie } })
    ).json()
    // both posts on ONE person...
    expect(person.data?.mentions?.length, 'both posts belong to one person').toBe(2)
    // ...held as TWO accounts, because both keys really were seen. The old
    // model had to pick one and strand the other on a separate row.
    expect(person.data?.aliases?.length, 'both identity keys are kept as accounts').toBe(2)
    expect(
      person.data?.aliases?.some((a: { profileUrl: string | null }) => a.profileUrl),
      'the URL-keyed account carries the profile link'
    ).toBe(true)
  })

  test('two people can be merged by hand, and the loser leaves the board', async ({
    page,
    request,
  }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const stamp = Date.now().toString(36)
    // same display name, different platforms — exactly the judgement call the
    // repair pass refuses to make automatically
    const a = await injectMention(request, {
      text: 'We are pricing out a CMS migration this quarter.',
      author: { handle: `e2e_x_${stamp}` },
      authorName: `E2E Person ${stamp}`,
      authorUrl: `https://x.com/e2e_x_${stamp}`,
      platform: 'x',
    })
    const b = await injectMention(request, {
      text: 'Same person, different platform, still pricing out a migration.',
      author: { handle: `e2e_rd_${stamp}` },
      authorName: `E2E Person ${stamp}`,
      authorUrl: `https://www.reddit.com/user/e2e_rd_${stamp}`,
      platform: 'reddit',
    })

    const personOf = async (mentionId: string) =>
      (await (await request.get(`${PULSE}/mentions/${mentionId}`, { headers: { cookie } })).json())
        .data?.person?.documentId
    const [winner, loser] = [await personOf(a.documentId), await personOf(b.documentId)]
    expect(winner).toBeTruthy()
    expect(loser).toBeTruthy()
    expect(loser, 'different platforms must NOT merge automatically').not.toBe(winner)

    // the display-name match is offered as a candidate, with its reason
    const cands = await (
      await request.get(`${PULSE}/people/${winner}/merge-candidates`, { headers: { cookie } })
    ).json()
    expect((cands.data ?? []).some((c: any) => c.documentId === loser)).toBe(true)

    const res = await request.post(`${PULSE}/people/${loser}/merge`, {
      headers: { cookie },
      data: { into: winner },
    })
    expect(res.ok()).toBeTruthy()

    const merged = await (
      await request.get(`${PULSE}/people/${winner}`, { headers: { cookie } })
    ).json()
    expect(merged.data?.mentions?.length, 'both mentions move to the survivor').toBe(2)
    // the survivor now holds BOTH platform presences — the point of the merge
    expect(merged.data?.aliases?.length, 'the survivor holds both accounts').toBe(2)
    expect(
      new Set(merged.data?.aliases?.map((a: { channel: string | null }) => a.channel)).size,
      'and they are on different platforms'
    ).toBe(2)

    // the tombstone is kept — the row still resolves — but it is off the board
    const board = await (await request.get(`${PULSE}/people/leads`, { headers: { cookie } })).json()
    expect((board.data ?? []).some((l: any) => l.documentId === loser)).toBe(false)

    // merging twice is refused rather than chaining tombstones
    const again = await request.post(`${PULSE}/people/${loser}/merge`, {
      headers: { cookie },
      data: { into: winner },
      failOnStatusCode: false,
    })
    expect(again.status()).toBe(409)
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
