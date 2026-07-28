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

  test('search finds recorded responses', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('Search mentions & past responses…').fill('uninstall')
    await expect(page.locator('a', { hasText: 'reply' }).first()).toBeVisible()
  })
})
