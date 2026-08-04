import { test, expect } from '@playwright/test'
import { injectMention } from './helpers'

test.describe('queue → claim → respond → outcome (the core loop)', () => {
  test('webhook-injected mention appears in the queue and walks the full loop', async ({
    page,
    request,
  }) => {
    const { externalId, documentId } = await injectMention(request)

    // find it via search (queue is oldest-first and can exceed a page with real data)
    await page.goto('/')
    await page.getByPlaceholder('Search mentions & past responses…').fill(externalId)
    await page.locator('a', { hasText: externalId }).first().click()
    await expect(page).toHaveURL(new RegExp(documentId))
    await expect(page.getByText(externalId)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible()
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
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    // label depends on the AI feature flag: "Correct analysis" (on) / "Set sentiment / topics" (off)
    await page.getByRole('button', { name: /correct analysis|set sentiment/i }).click()
    await page.getByRole('radio').nth(2).check() // negative
    await page.getByRole('button', { name: 'Save correction' }).click()
    await expect(page.getByText('human-corrected')).toBeVisible()
    await expect(page.getByText('corrected', { exact: true })).toBeVisible() // activity entry
  })

  test('octolens sentiment is adopted as initial label when AI is disabled', async ({ page, request }) => {
    const config = await (await request.get('http://localhost:3000/api/pulse/insights/config')).json().catch(() => null)
    // this behavior is keyless-only; with AI enabled Pulse analyzes instead
    test.skip(config?.data?.aiEnabled === true, 'AI enabled — Pulse analyzes, Octolens label ignored')

    const { documentId } = await injectMention(request, { sentiment: 'Negative' })
    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByText('negative', { exact: true }).first()).toBeVisible() // labeled at intake, no sweep wait
    await expect(page.getByText('analyzed by octolens')).toBeVisible()
  })

  test('acknowledge closes a mention without a public reply', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    await page.getByRole('button', { name: 'Acknowledge — no reply' }).click()
    await page.getByRole('radio', { name: /competitor/ }).check()
    await page.getByPlaceholder(/Why \(optional/).fill('competitor thread — replying would look pushy')
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()

    await expect(page.getByText('acknowledged', { exact: true }).first()).toBeVisible()
    // reason chip next to the status badge + reason in the activity trail
    await expect(page.getByText('competitor', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/acknowledged.*—.*competitor/).first()).toBeVisible()
  })

  test('timeline: notes with links and flat comments, no status change', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    // add a note with an attached resource link
    await page.getByRole('button', { name: 'Note (with resources)' }).click()
    await page.getByPlaceholder("The team's take, context, decisions…").fill('E2E note — competitor context')
    await page.getByPlaceholder('Attach a link…').fill('https://example.com/thread')
    await page.getByRole('button', { name: '+ Add link' }).click()
    await page.getByRole('button', { name: 'Add note' }).click()
    await expect(page.getByText('E2E note — competitor context')).toBeVisible()
    // scoped to the note: the mention's own url is also an example.com link,
    // so an unscoped locator matches the "View original" chrome too
    await expect(
      page.locator('li').filter({ hasText: 'E2E note — competitor context' }).getByRole('link', { name: /example\.com/ })
    ).toBeVisible()
    await expect(page.getByText('note', { exact: true })).toBeVisible() // amber badge

    // add a flat follow-up comment (chat-style, no nesting)
    await page.getByPlaceholder('Quick comment…').fill('E2E follow-up comment')
    // two buttons read "Comment": the kind toggle and the submit — submit is last
    await page.getByRole('button', { name: 'Comment', exact: true }).last().click()
    await expect(page.getByText('E2E follow-up comment')).toBeVisible()

    // discussion never changes workflow status
    await expect(page.getByText('unanswered', { exact: true }).first()).toBeVisible()

    // edit own comment (is-owner gated) — scope to the card, entries created
    // ms apart can swap positions, so positional selectors are unreliable
    const commentCard = page.locator('li').filter({ hasText: 'E2E follow-up comment' })
    await commentCard.getByRole('button', { name: 'Edit' }).click()
    await commentCard.locator('textarea').fill('E2E follow-up comment (revised)')
    await commentCard.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('E2E follow-up comment (revised)')).toBeVisible()
    await expect(page.getByText('(edited)')).toBeVisible()

    // delete own comment — inline confirm, no browser dialog
    const revisedCard = page.locator('li').filter({ hasText: '(revised)' })
    await revisedCard.getByRole('button', { name: 'Delete', exact: true }).click()
    await revisedCard.getByRole('button', { name: 'Delete?' }).click()
    await expect(page.getByText('E2E follow-up comment (revised)')).not.toBeVisible()
    await expect(page.getByText('E2E note — competitor context')).toBeVisible() // note untouched
  })

  test('new topics can be created inline from the labeling panel', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    const topicName = `E2E Topic ${Date.now().toString(36)}`
    await page.goto(`/mentions/${documentId}`)

    await page.getByRole('button', { name: /correct analysis|set sentiment/i }).click()
    // search and create share one box: typing filters, and creating is only
    // offered when nothing matches
    await page.getByPlaceholder('Search topics, or type a new one…').fill(topicName)
    await page.getByRole('button', { name: `+ Create “${topicName}”` }).click()
    await page.getByRole('button', { name: 'Save correction' }).click()

    await expect(page.getByText(`#${topicName}`).first()).toBeVisible()
  })

  test('topic picker filters instead of listing every topic', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)
    await page.getByRole('button', { name: /correct analysis|set sentiment/i }).click()

    const box = page.getByPlaceholder('Search topics, or type a new one…')
    await box.click()
    // the vocabulary is 100+ entries; the list must stay short enough to use
    // scoped: the timeline and queue also render list items
    const initial = await page.getByTestId('topic-options').getByRole('listitem').count()
    expect(initial).toBeLessThanOrEqual(9)

    await box.fill('webfl')
    await expect(page.getByRole('button', { name: 'Webflow', exact: true })).toBeVisible()
    // an existing topic must NOT offer creation — that is how the vocabulary forks
    await box.fill('Webflow')
    await expect(page.getByRole('button', { name: /\+ Create/ })).toBeHidden()
  })

  test('themes filter as you type, and view-queue links to that topic', async ({ page }) => {
    await page.goto('/themes')
    const count = page.getByTestId('themes-count')
    const before = (await count.textContent()) ?? ''

    // no submit button: typing alone narrows the list
    await page.getByLabel('Search themes').fill('webfl')
    await expect(count).not.toHaveText(before)
    // the right rail also renders a #Webflow chip — scope to the list
    await expect(page.getByRole('listitem').filter({ hasText: '#Webflow' }).first()).toBeVisible()

    // the filtered view stays linkable
    await expect(page).toHaveURL(/q=webfl/)

    // "view queue" must carry the topic, not a bare sentiment filter
    await page.getByRole('link', { name: 'view queue →' }).first().click()
    await expect(page).toHaveURL(/topic=/)
  })

  test('feedback search filters as you type', async ({ page }) => {
    await page.goto('/feedback?days=365')
    const box = page.getByLabel('Search feedback')
    await expect(box).toBeVisible()

    await box.fill('zzz-no-such-feedback-zzz')
    await expect(page.getByText('Nothing matches')).toBeVisible()

    await box.fill('')
    await expect(page.getByText('Nothing matches')).toBeHidden()
  })

  test('an event can be annotated onto the trend chart', async ({ page }) => {
    const title = `E2E event ${Date.now().toString(36)}`
    await page.goto('/trends')

    await page.getByRole('button', { name: 'Add event' }).click()
    await page.getByLabel('What happened').fill(title)
    await page.getByLabel('Kind').selectOption('incident')
    await page.getByRole('button', { name: 'Add event' }).click()

    // it lands in the list AND as a chart annotation. The SVG <title> is a
    // tooltip and never "visible", so every assertion scopes to the list row.
    const row = page.locator('li').filter({ hasText: title })
    await expect(row).toBeVisible()
    await expect(row).toContainText('(incident)')
    await expect(page.locator('svg title', { hasText: title })).toHaveCount(1)
  })

  test('the event form rejects an empty title', async ({ page }) => {
    await page.goto('/trends')
    await page.getByRole('button', { name: 'Add event' }).click()
    // submit stays disabled until there is something to save
    await expect(page.getByRole('button', { name: 'Add event' })).toBeDisabled()
  })

  test('competitor-only mentions are routed out of the reply queue, not discarded', async ({
    page,
    request,
  }) => {
    const tag = `lane${Date.now().toString(36)}`
    // a competitor-tagged post that never names Strapi: intel, not reply work
    const { documentId } = await injectMention(request, {
      text: `${tag} Webflow pricing keeps climbing for agencies`,
      keywords: [{ id: 1, keyword: 'webflow', keywordTag: 'competitor' }],
    })

    // absent from the default queue…
    await page.goto(`/?q=${tag}`)
    await expect(page.locator('li').filter({ hasText: tag })).toHaveCount(0)

    // …but fully intact in the monitor lane, never dropped
    await page.goto(`/?q=${tag}&lane=monitor`)
    await expect(page.locator('li').filter({ hasText: tag })).toHaveCount(1)

    // and reachable directly, with the routing reason recorded
    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByText(tag)).toBeVisible()
  })

  test('switching intent lands in the lead lane even with no Strapi keyword', async ({
    page,
    request,
  }) => {
    const tag = `lead${Date.now().toString(36)}`
    await injectMention(request, {
      text: `${tag} we are moving away from Webflow, it is too expensive at 60 sites`,
      keywords: [{ id: 1, keyword: 'webflow', keywordTag: 'competitor' }],
    })
    // the most valuable mentions name no Strapi keyword at all
    await page.goto(`/?q=${tag}&lane=lead`)
    await expect(page.locator('li').filter({ hasText: tag })).toHaveCount(1)
  })

  test('recording a reply auto-claims when you forgot to', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    // deliberately skip Claim — replying IS taking it
    await page.getByPlaceholder('What you actually replied…').fill('E2E auto-claim reply')
    await page.getByRole('button', { name: 'Record response' }).click()
    await expect(page.getByText('E2E auto-claim reply')).toBeVisible()

    // owner is now set, and the trail records that the claim was automatic
    await expect(page.getByText('answered', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('claimed', { exact: true }).first()).toBeVisible()
  })

  test('acknowledging auto-claims when you forgot to', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    await page.getByRole('button', { name: 'Acknowledge — no reply' }).click()
    await page.getByRole('radio', { name: /not relevant/ }).check()
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()

    await expect(page.getByText('acknowledged', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('claimed', { exact: true }).first()).toBeVisible()
  })

  test('claiming twice in a row cannot double-submit', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    const claim = page.getByRole('button', { name: /^Claim/ })
    // fire two clicks back to back — the second must hit a disabled button
    await claim.click()
    await expect(claim.or(page.getByRole('button', { name: 'Claiming…' })).first()).toBeDisabled()

    await expect(page.getByText('claimed', { exact: true }).first()).toBeVisible()

    // Assert on the record, not the page: "claimed" renders twice by design
    // (status badge + activity entry), so counting text can't tell one claim
    // from two. The activity trail is the source of truth.
    const res = await request.get(
      `http://localhost:3000/api/pulse/activities?filters[mention][documentId][$eq]=${documentId}&filters[action][$eq]=claimed`
    )
    const body = await res.json()
    expect(body.data.length, 'a double click must not record two claims').toBe(1)
  })

  test('marking a mention as ours closes it and keeps it out of the metrics', async ({
    page,
    request,
  }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    // one click, not three through the acknowledge panel
    await page.getByRole('button', { name: /^Ours/ }).click()
    await expect(page.getByText('acknowledged', { exact: true }).first()).toBeVisible()

    // reason is own-post, which is what excludes it from sentiment metrics
    const res = await request.get(`http://localhost:3000/api/pulse/mentions/${documentId}`)
    const body = await res.json()
    expect(body.data.acknowledgeReason).toBe('own-post')

    // and it's gone from the reply queue
    await page.goto('/')
    await expect(page.locator(`li[data-mention-id="${documentId}"]`)).toHaveCount(0)
  })

  test('lane filters are independent of sentiment, and "all lanes" shows everything', async ({
    page,
  }) => {
    await page.goto('/')
    const count = () => page.getByTestId('queue-count').textContent().then((t) => Number(t?.trim()))

    const replyWork = await count()

    // "all lanes" must be strictly larger — monitor is the bulk of the corpus
    await page.getByRole('link', { name: 'all lanes' }).click()
    await expect(page).toHaveURL(/lane=all/)
    expect(await count()).toBeGreaterThan(replyWork)

    // the sentiment "all" pill is a DIFFERENT axis — it must not reset the lane
    await page.getByRole('link', { name: 'all', exact: true }).click()
    await expect(page).toHaveURL(/lane=all/)
  })

  test('buttons show a pointer cursor, disabled ones do not', async ({ page }) => {
    // Tailwind v4 dropped preflight's cursor:pointer on buttons; without this
    // every control in the app silently loses its affordance on an upgrade
    await page.goto('/settings')
    const cursor = (sel: string) =>
      page.locator(sel).first().evaluate((el) => getComputedStyle(el).cursor)

    await expect(page.getByRole('button', { name: 'Mute author' })).toBeVisible()
    expect(await cursor('button:not(:disabled)')).toBe('pointer')
  })

  test('a lead is visibly marked in the queue, respond is not badged', async ({ page, request }) => {
    const tag = `bdg${Date.now().toString(36)}`
    await injectMention(request, {
      text: `${tag} we are moving away from Webflow, far too expensive at our size`,
      keywords: [{ id: 1, keyword: 'webflow', keywordTag: 'competitor' }],
    })
    await page.goto(`/?q=${tag}&lane=lead`)
    const row = page.locator('li').filter({ hasText: tag })
    await expect(row).toHaveCount(1)
    // the lane a human most needs to see is called out on the card itself
    await expect(row.getByText('lead', { exact: true })).toBeVisible()

    // 'respond' is the default view, so badging it on every row would be noise
    const { documentId } = await injectMention(request, { text: `${tag}r plain strapi question` })
    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByText('respond', { exact: true })).toHaveCount(0)
  })

  test('a timeline entry can be re-filed as feedback after the fact', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    const body = `refile ${Date.now().toString(36)}`
    await page.goto(`/mentions/${documentId}`)

    // typed as a plain comment first — the common mistake
    await page.getByPlaceholder('Quick comment…').fill(body)
    await page.getByRole('button', { name: 'Comment', exact: true }).last().click()
    const card = page.locator('li').filter({ hasText: body })
    await expect(card).toBeVisible()

    // re-file it as feedback; only feedback reaches the Feedback page
    await card.getByRole('button', { name: 'Edit' }).click()
    await card.getByRole('button', { name: 'Feedback' }).click()
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(card.getByText('feedback', { exact: true })).toBeVisible()

    await page.goto('/feedback?days=365')
    await expect(page.getByText(body)).toBeVisible()
  })

  test('competitor keyword auto-creates a competitor topic at ingest', async ({ page, request }) => {
    const { documentId } = await injectMention(request, {
      tags: ['competitor_mention'],
      keywords: [{ id: 1, keyword: 'payload', keywordTag: 'competitor' }],
    })
    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByText('#Payload').first()).toBeVisible()
  })

  test('keyboard triage: j/k focus, x select, a acknowledge — and never while typing', async ({
    page,
    request,
  }) => {
    const tag = `kbd${Date.now().toString(36)}`
    const old = { timestamp: '2018-06-01 00:00:00.000' }
    await injectMention(request, { text: `keyboard test ${tag} first`, ...old })
    await injectMention(request, { text: `keyboard test ${tag} second`, ...old })

    await page.goto(`/?q=${tag}`)
    await expect(page.getByRole('button', { name: /keyboard shortcuts/i })).toBeVisible()

    // shortcuts must NOT hijack typing — the global search box lives in the nav
    const search = page.getByPlaceholder('Search mentions & past responses…')
    await search.fill('jjjxxx')
    await expect(search).toHaveValue('jjjxxx')
    await expect(page.getByText(/\d+ selected/)).not.toBeVisible()
    await search.fill('')
    await page.getByRole('heading', { name: 'Queue' }).click()

    // j focuses the first card; x selects it AND turns bulk edit on implicitly
    await expect(page.getByRole('checkbox', { name: 'Select mention' })).toHaveCount(0)
    await page.keyboard.press('j')
    await page.keyboard.press('x')
    await expect(page.getByText('1 selected')).toBeVisible()
    await page.keyboard.press('j')
    await page.keyboard.press('x')
    await expect(page.getByText('2 selected')).toBeVisible()

    // whichever two cards the keyboard focused are the ones that must change —
    // read them from the DOM rather than assuming queue position
    const targets = await page.locator('[data-mention-id]').evaluateAll((els) =>
      els.slice(0, 2).map((el) => el.getAttribute('data-mention-id')!)
    )

    // a acknowledges the selection
    await page.keyboard.press('a')
    await expect(page.getByText('2 done')).toBeVisible()

    for (const id of targets) {
      await page.goto(`/mentions/${id}`)
      await expect(page.getByText('acknowledged', { exact: true }).first()).toBeVisible()
    }
  })

  test('sort toggle flips the queue between oldest- and newest-first', async ({ page, request }) => {
    const tag = `sort${Date.now().toString(36)}`
    // one very old, one brand new — each must lead its respective ordering
    await injectMention(request, { text: `sort test ${tag} ancient`, timestamp: '2018-01-01 00:00:00.000' })
    await injectMention(request, { text: `sort test ${tag} freshest` })

    await page.goto(`/?q=${tag}`)
    await expect(page.getByText(/oldest first\./)).toBeVisible()
    await expect(page.locator('li').first()).toContainText('ancient')

    await page.getByRole('link', { name: 'newest', exact: true }).click()
    await expect(page).toHaveURL(/sort=newest/)
    await expect(page.getByText(/newest first\./)).toBeVisible()
    await expect(page.locator('li').first()).toContainText('freshest')

    // back to the default drops the param
    await page.getByRole('link', { name: 'oldest', exact: true }).click()
    await expect(page).not.toHaveURL(/sort=/)
  })

  test('queue filter chips can CLEAR their filters (all / topic ✕ / status)', async ({ page }) => {
    await page.goto('/?sentiment=negative&topic=docs&status=claimed')

    // "all" must drop the sentiment param (regression: explicit-undefined override was ignored)
    await page.getByRole('link', { name: 'all', exact: true }).click()
    await expect(page).toHaveURL(/status=claimed/)
    await expect(page).not.toHaveURL(/sentiment=/)
    await expect(page).toHaveURL(/topic=docs/)

    // topic ✕ chip must drop the topic param
    await page.getByTitle('Clear topic filter').click()
    await expect(page).not.toHaveURL(/topic=/)
    await expect(page).toHaveURL(/status=claimed/)

    // "queue" status chip must drop the status param
    await page.getByRole('link', { name: 'queue', exact: true }).click()
    await expect(page).not.toHaveURL(/status=/)
  })

  test('muting an author shadow-blocks their mentions (queue + search + analytics)', async ({
    page,
    request,
  }) => {
    const handle = `slopbot_${Date.now().toString(36)}`
    const { externalId, documentId } = await injectMention(request, { author: { handle } })
    const search = () => page.getByPlaceholder('Search mentions & past responses…')

    // visible before the mute
    await page.goto('/')
    await search().fill(externalId)
    await expect(page.locator('a', { hasText: externalId }).first()).toBeVisible()

    // mute from the mention detail page — where you decide it, right after reading
    await page.goto(`/mentions/${documentId}`)
    await page.getByRole('button', { name: 'Mute author' }).click()
    await page.getByRole('button', { name: 'Mute', exact: true }).click()
    await expect(page.getByText('author muted')).toBeVisible()

    // and it shows up on the Settings list
    await page.goto('/settings')
    await expect(page.getByText(`@${handle}`)).toBeVisible()
    // scope to this handle's row — earlier test runs leave other muted authors
    await expect(page.locator('li').filter({ hasText: handle }).getByText('1 mention hidden')).toBeVisible()

    // spam is excluded from search (and from the queue + every analytic)
    await page.goto('/')
    await search().fill(externalId)
    await expect(page.getByText('No matches.')).toBeVisible()

    // unmute restores it everywhere
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Unmute' }).first().click()
    await expect(page.getByText(`@${handle}`)).not.toBeVisible()
    await page.goto('/')
    await search().fill(externalId)
    await expect(page.locator('a', { hasText: externalId }).first()).toBeVisible()
  })

  test('bulk triage: select mentions and acknowledge them in one pass', async ({ page, request }) => {
    const tag = `bulk${Date.now().toString(36)}`
    // queue is oldest-first: backdate so both land on page 1 regardless of volume
    const old = { timestamp: '2019-01-01 00:00:00.000' }
    const a = await injectMention(request, { text: `bulk triage test ${tag} one`, ...old })
    await injectMention(request, { text: `bulk triage test ${tag} two`, ...old })

    // scope the queue to this test's own fixtures — accumulated dev data would
    // otherwise push them off page 1
    await page.goto(`/?q=${tag}`)
    // checkboxes are hidden until bulk edit is on (queue stays readable)
    await expect(page.getByRole('checkbox', { name: 'Select mention' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Bulk edit' }).click()
    await expect(page.getByText(/\d+ selected/)).not.toBeVisible()

    const cards = page.locator('li').filter({ hasText: tag })
    await expect(cards).toHaveCount(2)
    await cards.nth(0).getByRole('checkbox', { name: 'Select mention' }).check()
    await cards.nth(1).getByRole('checkbox', { name: 'Select mention' }).check()
    await expect(page.getByText('2 selected')).toBeVisible()

    // bulk acknowledge → both leave the queue, result reported
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()
    await expect(page.getByText('2 done')).toBeVisible()

    await page.goto(`/mentions/${a.documentId}`)
    await expect(page.getByText('acknowledged', { exact: true }).first()).toBeVisible()
  })

  test('theme toggle cycles light → dark → system and persists', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: /^Theme:/ })
    const htmlIsDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
    const stored = () => page.evaluate(() => localStorage.getItem('pulse-theme'))

    // starts on system (nothing stored yet)
    await expect(toggle).toBeVisible()

    // system → light
    await toggle.click()
    expect(await stored()).toBe('light')
    expect(await htmlIsDark()).toBe(false)

    // light → dark
    await toggle.click()
    expect(await stored()).toBe('dark')
    expect(await htmlIsDark()).toBe(true)

    // survives a full reload with no flash-of-wrong-theme (script runs pre-paint)
    await page.reload()
    expect(await htmlIsDark()).toBe(true)
    expect(await stored()).toBe('dark')

    // dark → system
    await page.getByRole('button', { name: /^Theme:/ }).click()
    expect(await stored()).toBe('system')
  })

  test('reply box is never prefilled; a saved draft is a collapsed accordion', async ({
    page,
    request,
  }) => {
    // 1. fresh mention (no draft): empty box, no accordion at all
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)
    await expect(page.getByPlaceholder('What you actually replied…')).toHaveValue('')
    await expect(page.getByText(/Draft ready/)).not.toBeVisible()

    // 2. a mention that DOES have a draft (drafts are written by agents via
    //    pulse-save-draft, so use the queue's has-draft filter to find one)
    await page.goto('/?draft=1')
    const open = page.getByRole('link', { name: 'Open' }).first()
    test.skip((await open.count()) === 0, 'no drafted mentions in this environment')
    await open.click()

    const reply = page.getByPlaceholder('What you actually replied…')
    await expect(reply).toHaveValue('') // still empty — the draft is a suggestion
    const accordion = page.getByText(/Draft ready/)
    await expect(accordion).toBeVisible()

    // clicking "Use this draft" copies it into the reply box
    await page.getByRole('button', { name: 'Use this draft' }).click()
    await expect(reply).not.toHaveValue('')
  })

  test('leaderboard ranks by replies posted and credits the reply you record', async ({
    page,
    request,
  }) => {
    const { documentId } = await injectMention(request)

    // the right rail is display:none below the xl breakpoint — pin a wide
    // viewport rather than skipping (a test that silently skips proves nothing)
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    const board = page.locator('aside').filter({ hasText: 'Team celebration' })
    await expect(board.getByRole('heading', { name: /Team celebration/ })).toBeVisible()

    // record a public reply, which must credit the signed-in user
    await page.goto(`/mentions/${documentId}`)
    await page.getByRole('button', { name: 'Claim' }).click()
    await page.getByPlaceholder('What you actually replied…').fill('E2E leaderboard reply')
    await page.getByRole('button', { name: 'Record response' }).click()
    await expect(page.getByText('E2E leaderboard reply')).toBeVisible()

    await page.goto('/')
    // the rail scrolls independently — bring the row into view before asserting
    const row = board.locator('li').filter({ hasText: 'dana' }).first()
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeVisible()
    await expect(row).toContainText('replies')
  })

  test('the queue header counts the whole filtered set, not just this page', async ({ page }) => {
    await page.goto('/')
    const badge = page.getByTestId('queue-count')
    await expect(badge).toBeVisible()
    const open = Number((await badge.textContent())?.trim())
    expect(open).toBeGreaterThan(0)

    // page size is 25, so on a fuller queue the count must exceed what's rendered
    const rows = await page.locator('li[data-mention-id]').count()
    expect(open).toBeGreaterThanOrEqual(rows)

    // and it tracks the active filter rather than being a fixed total
    await page.goto('/?status=acknowledged')
    const acked = Number((await page.getByTestId('queue-count').textContent())?.trim())
    expect(acked).not.toBe(open)
  })

  test('feedback captured in the timeline lands on the Feedback page', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    const tag = `fb${Date.now().toString(36)}`

    await page.goto(`/mentions/${documentId}`)
    await page.getByRole('button', { name: 'Feedback' }).click()
    await page
      .getByPlaceholder('What the author said back / product insight to capture…')
      .fill(`Pain point ${tag}: populate API is confusing for newcomers`)
    // tag the product area — this is the prioritisation axis on /feedback
    await page.getByPlaceholder('Tag the area (visual editor, admin panel…)').fill(`Area ${tag}`)
    await page.getByRole('button', { name: '+ Add tag' }).click()
    await page.getByRole('button', { name: 'Add feedback' }).click()
    await expect(page.getByText(`Pain point ${tag}`)).toBeVisible()

    await page.goto('/feedback')
    await expect(page.getByRole('heading', { name: 'Product feedback' })).toBeVisible()
    await expect(page.getByText(`Pain point ${tag}`)).toBeVisible()
    // the tag renders on the entry AND becomes a filter chip with a count
    await expect(page.getByRole('link', { name: `#Area ${tag}` }).first()).toBeVisible()
  })

  test('"mentions Strapi" filter narrows the queue to posts naming us', async ({ page, request }) => {
    const tag = `q${Date.now().toString(36)}`
    const old = { timestamp: '2017-03-01 00:00:00.000' }
    // `q` is a single $containsi substring, not an AND of terms — so the
    // Strapi-naming fixture embeds the discriminator IN the tag token, letting
    // one substring select it alone.
    await injectMention(request, { text: `${tag}strapi this one names Strapi explicitly`, ...old })
    await injectMention(request, { text: `${tag}other this one is about something else`, ...old })

    // Scope by this run's tag rather than trusting the fixtures onto page 1:
    // every run backdates to the SAME instant, so once 25+ mentions tie on
    // postedAt, which ones make the first page is arbitrary. Searching is
    // deterministic at any data volume.
    await page.goto(`/?q=${tag}`)
    await expect(page.locator('li').filter({ hasText: tag })).toHaveCount(2)

    // narrowing: the substring that only the Strapi-naming fixture carries
    await page.goto(`/?q=${tag}strapi`)
    await expect(page.locator('li').filter({ hasText: tag })).toHaveCount(1)
    await expect(page.locator('li').filter({ hasText: `${tag}other` })).toHaveCount(0)

    // and the "mentions Strapi" pill still wires up to the strapi query
    await page.goto('/')
    await page.getByRole('link', { name: 'mentions Strapi' }).click()
    await expect(page).toHaveURL(/q=strapi/)
  })

  /**
   * The spam heuristic reads promotional language, and one of us recommending
   * Strapi IS promotional language — a real Reddit comment of ours was flagged
   * for it. No wording change can separate the two; only knowing whose account
   * it is can. This asserts the allowlist does exactly that, with identical
   * text on both sides so nothing else can explain the difference.
   */
  /**
   * A response transcribes something that lives on another platform, so it goes
   * stale in ways a note never does — a typo pasting it back, or an edit made
   * on the platform afterwards. Correcting it must be possible and must be
   * visible, because outcome and sentiment were recorded against what was
   * actually said.
   */
  test('a recorded reply can be corrected and withdrawn', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    await page.getByPlaceholder('What you actually replied…').fill('Frist draft with a typo.')
    await page.getByRole('button', { name: 'Record response' }).click()
    await expect(page.getByText('Frist draft with a typo.')).toBeVisible()
    // nothing claims to be edited until it is
    await expect(page.getByText('(edited)')).toBeHidden()

    await page.getByRole('button', { name: 'Edit' }).first().click()
    await page.getByLabel('Recorded reply').fill('First draft, corrected.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(page.getByText('First draft, corrected.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Frist draft with a typo.')).toBeHidden()
    // a corrected reply must never be able to pass as the original wording
    await expect(page.getByText('(edited)')).toBeVisible()

    // withdrawing is two steps and no browser dialog — a native confirm() would
    // block the page and the extension driving it
    await page.getByRole('button', { name: 'Withdraw', exact: true }).first().click()
    // Scoped to the Responses section: the timeline keeps its own "answered"
    // accordion, which is a separate surface fed by the same data and catches
    // up on the next load. What this feature owns is the record itself.
    const responses = page.getByTestId('responses')
    await page.getByRole('button', { name: 'Withdraw?' }).click()
    await expect(responses.getByText('First draft, corrected.')).toBeHidden({ timeout: 15_000 })

    // and it is gone from the server, not just from this render
    await page.reload()
    await expect(page.getByText('No response recorded yet.')).toBeVisible()
  })

  /**
   * Octolens ingests every comment in a thread as its own mention, so an
   * exchange arrives as N unrelated queue rows. Reading one told you nothing
   * about what was already said — or that the person you answered has replied
   * again and is waiting, which is how a Reddit follow-up sat unanswered for
   * three days while the reply was written by hand on the platform.
   */
  test('a mention shows the rest of its conversation, and flags replies after ours', async ({
    page,
    request,
  }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const post = `1v${Date.now().toString(36)}`
    const thread = (id: string, handle: string, text: string) =>
      injectMention(request, {
        text,
        author: { handle },
        platform: 'reddit',
        // the conversation is derived from the permalink — the payload carries
        // no parent or thread field
        url: `https://www.reddit.com/r/nextjs/comments/${post}/some_slug/${id}/`,
      })

    const first = await thread('c1', `e2e_asker_${post}`, 'Which headless CMS would you pick here?')
    // seeded into the team allowlist at boot, so this counts as ours
    await thread('c2', 'codingafterthirty', 'Strapi is worth a look for that shape of project.')
    await thread('c3', `e2e_asker_${post}`, 'Thanks — one more question about hosting cost?')

    await page.goto(`/mentions/${first.documentId}`)

    // all three, in posting order, as one conversation
    const convo = page.locator('section').filter({ hasText: 'Conversation' }).first()
    await expect(convo.getByText('3 messages')).toBeVisible()
    await expect(convo.getByText('Thanks — one more question about hosting cost?')).toBeVisible()
    await expect(convo.getByText('us', { exact: true })).toBeVisible()

    // the signal worth interrupting for: they spoke after we did
    await expect(page.getByText(/after your last answer/)).toBeVisible()
  })

  test('our own posts are never flagged as spam, and never queued as reply work', async ({
    page,
    request,
  }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const stamp = Date.now()
    // trips the promo-link-farm heuristic
    const text = `Nice setup — we shipped ours on https://demo-${stamp}.vercel.app and it went well.`

    const outsider = await injectMention(request, {
      text,
      author: { handle: `e2e_outsider_${stamp}` },
      platform: 'reddit',
    })
    // seeded into the allowlist at boot (previously hardcoded in person.ts)
    const ours = await injectMention(request, {
      text,
      author: { handle: 'codingafterthirty' },
      platform: 'reddit',
    })

    // through the authenticated proxy: Strapi's own route 403s unauthenticated,
    // and a null body would read as "no quality set" rather than as a failure
    const read = async (id: string) =>
      (
        await (
          await request.get(`http://localhost:3000/api/pulse/mentions/${id}`, {
            headers: { cookie },
          })
        ).json()
      ).data

    const theirs = await read(outsider.documentId)
    const mine = await read(ours.documentId)

    expect(theirs.quality, 'the same text from a stranger is still suspected').toBe('suspected-spam')
    expect(mine.quality, 'ours is not spam, whatever it sounds like').toBe('normal')
    expect(mine.acknowledgeReason, 'and nobody replies to their own post').toBe('own-post')
  })

  test('possible-spam flag marks a mention and can be cleared', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    await page.getByRole('button', { name: 'Possible spam' }).click()
    await expect(page.getByRole('button', { name: 'Not spam' })).toBeVisible()
    await expect(page.getByText('suspected spam').first()).toBeVisible()

    // it shows in the suspected-spam review bucket
    await page.goto('/?quality=suspected-spam')
    await expect(page.locator('li').filter({ hasText: 'suspected spam' }).first()).toBeVisible()

    // clearing restores it
    await page.goto(`/mentions/${documentId}`)
    await page.getByRole('button', { name: 'Not spam' }).click()
    await expect(page.getByRole('button', { name: 'Possible spam' })).toBeVisible()
  })

  test('labeling and acknowledge panels can be dismissed (X and Escape)', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    // labeling panel: close with the X, nothing saved
    await page.getByRole('button', { name: /correct analysis|set sentiment/i }).click()
    await expect(page.getByRole('button', { name: 'Save correction' })).toBeVisible()
    await page.getByRole('button', { name: 'Close without saving' }).click()
    await expect(page.getByRole('button', { name: 'Save correction' })).not.toBeVisible()
    await expect(page.getByText('human-corrected')).not.toBeVisible()

    // acknowledge panel: close with Escape, mention stays unanswered
    await page.getByRole('button', { name: 'Acknowledge — no reply' }).click()
    await expect(page.getByText('Close without a public reply')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Close without a public reply')).not.toBeVisible()
    await expect(page.getByText('unanswered', { exact: true }).first()).toBeVisible()
  })

  test('search finds recorded responses', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Search mentions & past responses…').fill('uninstall')
    await expect(page.locator('a', { hasText: 'reply' }).first()).toBeVisible()
  })
})
