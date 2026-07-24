import type { Core } from '@strapi/strapi'

/**
 * Dev/demo seed — runs only when PULSE_SEED_DEMO=true and the DB has no mentions.
 * Production starts EMPTY by design (greenfield decision in the build spec).
 * Users go through the U&P user service so passwords hash (query().create stores
 * them raw and login fails — cookbook trap).
 */

const USERS = [
  { username: 'dana', email: 'dana@example.com', password: 'PulseDemo1!' },
  { username: 'mark', email: 'mark@example.com', password: 'PulseDemo1!' },
  { username: 'priya', email: 'priya@example.com', password: 'PulseDemo1!' },
]

const TOPICS = [
  { name: 'Docs', kind: 'docs' },
  { name: 'Migrations', kind: 'feature' },
  { name: 'Better Auth plugin', kind: 'feature' },
  { name: 'Bugs', kind: 'bug' },
  { name: 'Deployment', kind: 'feature' },
  { name: 'Competitor comparison', kind: 'competitor' },
]

const SAMPLES: Array<{ text: string; label: 'positive' | 'neutral' | 'negative'; score: number; topics: string[]; platform: string; handle: string }> = [
  { text: 'The Strapi v5 migration guide skipped the documentId change — took me hours to figure out.', label: 'negative', score: -0.7, topics: ['Migrations', 'Docs'], platform: 'x', handle: 'dev_amir' },
  { text: 'Loving the new Strapi admin — the content builder is so much cleaner now.', label: 'positive', score: 0.8, topics: ['Docs'], platform: 'reddit', handle: 'happy_builder' },
  { text: 'Strapi vs Contentful — honestly Strapi wins on flexibility, Contentful on onboarding.', label: 'neutral', score: 0.1, topics: ['Competitor comparison'], platform: 'hackernews', handle: 'cms_curious' },
  { text: 'Better Auth plugin refuses to boot with users-permissions installed, error message could be clearer.', label: 'negative', score: -0.5, topics: ['Better Auth plugin', 'Bugs'], platform: 'reddit', handle: 'auth_wrangler' },
  { text: 'Deployed to Strapi Cloud in 15 minutes, deploy-on-push is slick.', label: 'positive', score: 0.7, topics: ['Deployment'], platform: 'x', handle: 'ship_it_sam' },
  { text: 'The populate API in v5 is confusing, docs example 404s.', label: 'negative', score: -0.6, topics: ['Docs', 'Bugs'], platform: 'x', handle: 'query_quinn' },
  { text: 'Strapi MCP server is GA now — wiring Claude to our CMS was surprisingly easy.', label: 'positive', score: 0.9, topics: ['Deployment'], platform: 'bluesky', handle: 'ai_tinkerer' },
  { text: 'Anyone else seeing slow cold starts on self-hosted Strapi after 5.50?', label: 'negative', score: -0.4, topics: ['Bugs', 'Deployment'], platform: 'reddit', handle: 'perf_paula' },
  { text: 'Wrote up how we model multi-brand content in Strapi — components + dynamic zones are underrated.', label: 'positive', score: 0.6, topics: ['Docs'], platform: 'linkedin', handle: 'arch_annie' },
  { text: 'Migration from v4 went fine overall, a few plugin gaps but core was smooth.', label: 'neutral', score: 0.2, topics: ['Migrations'], platform: 'reddit', handle: 'steady_steve' },
]

export async function seedDemo(strapi: Core.Strapi) {
  const existing = await strapi.documents('api::mention.mention').count({})
  if (existing > 0) {
    strapi.log.info('pulse: demo seed skipped (mentions exist)')
    return
  }
  strapi.log.info('pulse: seeding demo data…')

  // users — via the U&P service so passwords hash
  const authRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } })
  const users: any[] = []
  for (const u of USERS) {
    const found = await strapi
      .query('plugin::users-permissions.user')
      .findOne({ where: { email: u.email } })
    users.push(
      found ??
        (await strapi.plugin('users-permissions').service('user').add({
          ...u,
          role: authRole.id,
          confirmed: true,
          blocked: false,
          provider: 'local',
        }))
    )
  }

  // topics
  const topicByName = new Map<string, any>()
  for (const t of TOPICS) {
    let topic = await strapi.documents('api::topic.topic').findFirst({ filters: { name: t.name } })
    if (!topic) topic = await strapi.documents('api::topic.topic').create({ data: t as any })
    topicByName.set(t.name, topic)
  }

  // events
  const now = Date.now()
  const DAY = 86400000
  for (const e of [
    { title: 'v5.51 release', date: new Date(now - 12 * DAY).toISOString(), kind: 'release' },
    { title: 'MCP server GA announcement', date: new Date(now - 6 * DAY).toISOString(), kind: 'launch' },
  ]) {
    const found = await strapi.documents('api::event.event').findFirst({ filters: { title: e.title } })
    if (!found) await strapi.documents('api::event.event').create({ data: e as any })
  }

  // mentions spread over the past ~20 days, pre-analyzed so trends render
  const channels = await strapi.documents('api::channel.channel').findMany({ pagination: { limit: -1 } as any })
  const channelByKey = new Map(channels.map((c: any) => [c.key, c]))
  let i = 0
  for (const s of SAMPLES) {
    const postedAt = new Date(now - (20 - i * 2) * DAY - (i % 3) * 3600e3).toISOString()
    const mention = await strapi.documents('api::mention.mention').create({
      data: {
        externalId: `seed-${i}`,
        content: s.text,
        authorHandle: s.handle,
        url: `https://example.com/seed/${i}`,
        postedAt,
        receivedAt: postedAt,
        channel: (channelByKey.get(s.platform) as any)?.documentId ?? null,
        sentimentScore: s.score,
        sentimentLabel: s.label,
        analysisStatus: 'analyzed',
        status: 'unanswered',
        topics: s.topics.map((n) => topicByName.get(n).documentId),
        modelVersion: 'seed-demo',
        promptVersion: 'v1',
        raw: { seeded: true },
      } as any,
    })
    await strapi.documents('api::activity.activity').create({
      data: { mention: mention.documentId, action: 'ingested', at: postedAt, detail: { seeded: true } } as any,
    })
    await strapi.documents('api::activity.activity').create({
      data: { mention: mention.documentId, action: 'analyzed', at: postedAt, detail: { modelVersion: 'seed-demo' } } as any,
    })

    // a couple of answered examples with outcomes → response library has content
    if (i === 0 || i === 3) {
      const response = await strapi.documents('api::response.response').create({
        data: {
          mention: mention.documentId,
          draftText: 'Thanks for flagging — here is the relevant docs section…',
          finalText:
            i === 0
              ? 'Sorry about that! The documentId change is covered in the v5 breaking-changes list — https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes — we are adding it to the migration guide too. Appreciate the flag!'
              : 'You need to fully uninstall users-permissions (npm uninstall), not just disable it — the plugins conflict at boot. Better error message is on our list!',
          respondedBy: users[0].id,
          respondedAt: new Date(new Date(postedAt).getTime() + 4 * 3600e3).toISOString(),
          notes: 'seeded example response',
          outcome: {
            result: i === 0 ? 'positive-turn' : 'resolved',
            notes: 'author thanked us',
            recordedAt: new Date(new Date(postedAt).getTime() + DAY).toISOString(),
          },
        } as any,
      })
      await strapi.documents('api::mention.mention').update({
        documentId: mention.documentId,
        data: { status: i === 3 ? 'resolved' : 'answered', owner: users[0].id } as any,
      })
      await strapi.documents('api::activity.activity').create({
        data: {
          mention: mention.documentId,
          actor: users[0].id,
          action: 'answered',
          at: new Date(new Date(postedAt).getTime() + 4 * 3600e3).toISOString(),
          detail: { responseDocumentId: response.documentId },
        } as any,
      })
    }
    i++
  }

  // one dead letter so the admin view has an example
  const dl = await strapi.documents('api::dead-letter.dead-letter').count({})
  if (dl === 0) {
    await strapi.documents('api::dead-letter.dead-letter').create({
      data: {
        raw: { unexpected: 'shape', note: 'seeded example' },
        error: 'missing required fields (externalId: false, content: false)',
        receivedAt: new Date().toISOString(),
        resolved: false,
      } as any,
    })
  }

  strapi.log.info(
    `pulse: demo seed complete — ${SAMPLES.length} mentions, ${USERS.length} users (password: PulseDemo1!)`
  )
}
