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
    // both posts on ONE person — the old model stranded them on separate rows
    expect(person.data?.mentions?.length, 'both posts belong to one person').toBe(2)
    // Two account rows exist (both keys really were seen and are kept), but the
    // alias VIEW collapses them: same handle, same channel, one presence.
    // Listing both would read as two accounts and make the person more
    // ambiguous, not less.
    expect(person.data?.aliases?.length, 'one presence, however many keys').toBe(1)
    expect(
      person.data?.aliases?.[0]?.profileUrl,
      'and it keeps the row worth linking to'
    ).toBeTruthy()
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

  /**
   * The profile is the one thing on a person that no signal creates. Starting
   * one IS the pre-qualification — there is no separate flag to fall out of
   * sync with it — so these assertions are really about that boundary holding.
   */
  test('a profile is only ever started by a human, and keeps the lead on the board', async ({
    page,
    request,
  }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const handle = `e2e_prof_${Date.now().toString(36)}`
    await injectMention(request, {
      text: 'Costing out a move away from Webflow this quarter.',
      author: { handle },
      authorUrl: `https://x.com/${handle}`,
    })

    const board = async () =>
      (await (await request.get(`${PULSE}/people/leads`, { headers: { cookie } })).json()).data ?? []
    // ingest alone must never mint a profile, whatever the post says
    const before = (await board()).find((l: any) => l.handle === handle)
    expect(before?.profile ?? null, 'ingest must not create a profile').toBeNull()

    const personId =
      before?.documentId ??
      (
        await (
          await request.get(`${PULSE}/mentions/${
            (await injectMention(request, { author: { handle }, authorUrl: `https://x.com/${handle}` }))
              .documentId
          }`, { headers: { cookie } })
        ).json()
      ).data?.person?.documentId
    expect(personId).toBeTruthy()

    await page.goto(`/leads/${personId}`)
    await expect(page.getByText('No profile yet')).toBeVisible()
    await page.getByRole('button', { name: 'Start a profile' }).click()

    // the gate is stated before it is met, so it is never a mystery
    await expect(page.getByText(/Add an email to make this actionable/)).toBeVisible()
    await page.getByPlaceholder('name@company.com').fill('someone@acme.com')
    await page.getByPlaceholder('Acme Inc').fill('Acme')
    await page.getByRole('button', { name: 'Create profile' }).click()
    await expect(page.getByText(/Reachable/)).toBeVisible({ timeout: 15_000 })

    // survives a reload, and the trail records that it happened
    await page.reload()
    await expect(page.getByPlaceholder('name@company.com')).toHaveValue('someone@acme.com')
    await expect(page.getByText('profile updated').first()).toBeVisible()

    // a rubbish address is refused rather than stored
    const bad = await request.put(`${PULSE}/people/${personId}/lead-profile`, {
      headers: { cookie },
      data: { email: 'nope' },
      failOnStatusCode: false,
    })
    expect(bad.status()).toBe(400)

    // and the worked lead stays on the board even with no intent score at all
    const listed = (await board()).find((l: any) => l.documentId === personId)
    expect(listed, 'a profiled person stays listed').toBeTruthy()
    expect(listed.profile).toMatchObject({ started: true, hasEmail: true, company: 'Acme' })
  })

  /**
   * Suggestions must never be able to pass themselves off as verified. The
   * server drops any finding whose quote is not literally in the post, so this
   * asserts the SHAPE that guarantee relies on: every suggestion carries its
   * evidence, and nothing is written by asking.
   */
  test('identity suggestions are quoted, and asking for them writes nothing', async ({
    page,
    request,
  }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const handle = `e2e_ident_${Date.now().toString(36)}`
    const { documentId } = await injectMention(request, {
      text: 'I lead engineering at Northwind Logistics and we are costing out a move off Webflow.',
      author: { handle },
      authorUrl: `https://x.com/${handle}`,
    })
    const m = await (
      await request.get(`${PULSE}/mentions/${documentId}`, { headers: { cookie } })
    ).json()
    const personId = m.data?.person?.documentId
    expect(personId).toBeTruthy()

    const res = await request.post(`${PULSE}/people/${personId}/suggest-identity`, {
      headers: { cookie },
      failOnStatusCode: false,
    })
    // keyless (CI) disables the feature outright rather than degrading it —
    // the same contract as drafts and chat
    test.skip(res.status() === 503, 'AI disabled — suggestions are off, by design')
    expect(res.ok()).toBeTruthy()

    const suggestions = (await res.json()).data ?? []
    for (const s of suggestions) {
      expect(['company', 'role']).toContain(s.field)
      expect(s.evidence, 'a suggestion without its quote must never reach the UI').toBeTruthy()
    }

    // asking is read-only: no profile appears just because we looked
    const person = await (
      await request.get(`${PULSE}/people/${personId}`, { headers: { cookie } })
    ).json()
    expect(person.data?.leadProfile ?? null, 'suggesting must not create a profile').toBeNull()
  })

  /**
   * The decision to research someone happens while READING their post, not
   * while browsing a board. Before this, acting on it meant leaving for Leads
   * and finding them again — so the mention page now answers "do we know who
   * this is" and links straight into the form.
   */
  test('the mention page says whether we know the author, and starts a profile', async ({
    page,
    request,
  }) => {
    const handle = `e2e_mprof_${Date.now().toString(36)}`
    const { documentId } = await injectMention(request, {
      text: 'Evaluating a headless CMS to replace our Webflow setup this quarter.',
      author: { handle },
      authorUrl: `https://x.com/${handle}`,
    })

    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByText(new RegExp(`No profile for @${handle}`))).toBeVisible()

    // the link lands in an OPEN form — nothing is created by arriving
    await page.getByRole('link', { name: 'Start a profile →' }).click()
    await expect(page).toHaveURL(/\/leads\/[a-z0-9]+\?profile=1/)
    const email = page.getByPlaceholder('name@company.com')
    await expect(email).toBeVisible()

    await email.fill('author@northwind.test')
    await page.getByRole('button', { name: 'Create profile' }).click()
    await expect(page.getByText(/Reachable/)).toBeVisible({ timeout: 15_000 })

    // ...and the answer follows the person back to the post
    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByText('Profile · reachable')).toBeVisible()
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
