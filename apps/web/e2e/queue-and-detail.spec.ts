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

  test('internal note records commentary without answering the mention', async ({ page, request }) => {
    const { documentId } = await injectMention(request)
    await page.goto(`/mentions/${documentId}`)

    await page.getByRole('checkbox', { name: /internal note only/i }).check()
    await page.getByPlaceholder('The team’s take on this mention…').fill('E2E internal-only commentary')
    await page.getByRole('button', { name: 'Save internal note' }).click()

    await expect(page.getByText('E2E internal-only commentary')).toBeVisible()
    await expect(page.getByText('internal note', { exact: true })).toBeVisible()
    // status must NOT flip to answered
    await expect(page.getByText('unanswered', { exact: true }).first()).toBeVisible()
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
