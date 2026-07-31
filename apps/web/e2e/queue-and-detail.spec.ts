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
    await expect(page.getByRole('link', { name: /example\.com/ })).toBeVisible()
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
    await page.getByPlaceholder('New topic name…').fill(topicName)
    await page.getByRole('button', { name: '+ Add topic' }).click()
    await page.getByRole('button', { name: 'Save correction' }).click()

    await expect(page.getByText(`#${topicName}`).first()).toBeVisible()
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
