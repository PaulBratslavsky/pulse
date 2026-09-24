import { test, expect } from '@playwright/test'

/**
 * Muting a topic is the noise filter: it drops a topic out of every metric
 * while leaving its mentions readable, and never touches the lead lane.
 *
 * The round trip is what matters here. A mute that cannot be undone cleanly is
 * worse than no mute at all, because the data it hides looks deleted — so the
 * test always unmutes, and asserts the theme comes back.
 */

const cookieHeader = async (page: import('@playwright/test').Page) =>
  (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')

test.describe('muted topics', () => {
  test('mute removes a theme from the report, unmute restores it', async ({ page }) => {
    await page.goto('/themes')

    const firstRow = page.locator('li', { hasText: 'mentions' }).first()
    await expect(firstRow).toBeVisible()
    const label = await firstRow.locator('span.font-medium').first().innerText()
    const name = label.replace(/^#/, '')
    const countOf = async () => {
      const row = page.locator('li', { hasText: `#${name}` }).first()
      if ((await row.count()) === 0) return 0
      const text = await row.innerText()
      return Number(text.match(/(\d+) mentions/)?.[1] ?? 0)
    }
    const before = await countOf()
    expect(before).toBeGreaterThan(0)

    await firstRow.getByTestId('mute-topic').click()

    // Muting does NOT necessarily remove the topic from the report, and asserting
    // that it vanishes is wrong: the lead lane is exempt, so a topic with leads
    // correctly stays, carrying only those. What muting guarantees is that its
    // non-lead mentions stop counting — so the number must go DOWN.
    // Nothing is asserted about the total theme count either: the analysis sweep
    // runs every minute against the same database and moves unrelated topics in
    // and out of the window on its own.
    await expect.poll(countOf, { timeout: 15_000 }).toBeLessThan(before)

    // it is listed as muted, with the topic name — not a bare slug
    await page.goto('/settings')
    const panel = page.locator('div', { has: page.getByRole('heading', { name: 'Muted topics' }) }).last()
    await expect(panel.getByText(`#${name}`, { exact: true })).toBeVisible()

    await panel.getByRole('button', { name: /Unmute/ }).first().click()

    // back in the report with its full volume — the mentions were hidden from
    // the numbers, never destroyed
    await page.goto('/themes')
    await expect(page.getByText(`#${name}`, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect.poll(countOf, { timeout: 15_000 }).toBeGreaterThanOrEqual(before)
  })

  test('a muted topic never hides a lead', async ({ page, request }) => {
    const headers = { cookie: await cookieHeader(page) }

    const themes = await (await request.get('/api/pulse/insights/themes', { headers })).json()
    const topic = themes.data.themes[0]?.topic
    test.skip(!topic, 'no themes in this dataset')

    const muted = await (
      await request.post('/api/pulse/muted-topics/mute', {
        headers,
        data: { slug: topic.slug, reason: 'not-a-competitor' },
      })
    ).json()
    expect(muted.data.muted).toBe(true)

    try {
      // every lead carrying this topic is still visible and still counted
      const leads = await (
        await request.get('/api/pulse/mentions', {
          headers,
          params: {
            'filters[topics][slug][$eq]': topic.slug,
            'filters[lane][$eq]': 'lead',
            'pagination[pageSize]': 100,
          },
        })
      ).json()
      for (const m of leads.data ?? []) expect(m.topicMuted).not.toBe(true)
    } finally {
      const list = await (await request.get('/api/pulse/muted-topics', { headers })).json()
      const row = (list.data as { documentId: string; slug: string }[] | undefined)?.find(
        (r) => r.slug === topic.slug
      )
      if (row) await request.delete(`/api/pulse/muted-topics/${row.documentId}/unmute`, { headers })
    }
  })

  test('suggestions never recommend a product topic', async ({ page, request }) => {
    const headers = { cookie: await cookieHeader(page) }
    const res = await (
      await request.get('/api/pulse/muted-topics/suggestions', {
        headers,
        params: { days: 3650, minMentions: 1 },
      })
    ).json()

    for (const s of res.data.suggestions) {
      // feature / bug / docs describe OUR product — a high `na` share there
      // means the classifier mislabeled sentiment, not that the topic is noise
      expect(['competitor', 'other']).toContain(s.topic.kind)
      // a share is measured over the mentions the mute would actually hide, so
      // it can never exceed 1 — the bug that let leads inflate the numerator
      expect(s.naShare).toBeLessThanOrEqual(1)
      expect(s.monitorShare).toBeLessThanOrEqual(1)
      expect(s.affected).toBeLessThanOrEqual(s.mentions)
    }
  })
})
