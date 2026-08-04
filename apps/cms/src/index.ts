import type { Core } from '@strapi/strapi'
import { seedDemo } from './seed-demo'
import { registerAllMcpTools, registerMcpToolPermissions } from './mcp'
import { dedupeMentionsAndEnforceUnique } from './utils/dedupe-mentions'
import { dedupeSplitPeople } from './utils/dedupe-people'
import { splitSocialAccounts } from './utils/split-social-accounts'
import { SEED_TEAM_HANDLES } from './api/person/services/person'
import { reclaimOurPosts } from './utils/reclaim-our-posts'
import { backfillPeople } from './utils/backfill-people'

/** Actions the Authenticated (team member) role gets. Each is its own permission record —
 *  a fresh Strapi denies everything for BOTH roles, and admin-UI clicks don't survive a fresh DB. */
const AUTHENTICATED_ACTIONS = [
  'api::mention.mention.find',
  'api::mention.mention.findOne',
  'api::mention.mention.claim',
  'api::mention.mention.bulk',
  'api::mention.mention.quality',
  'api::mention.mention.acknowledge',
  'api::comment.comment.create',
  'api::comment.comment.update',
  'api::comment.comment.delete',
  'api::mention.mention.route',
  'api::mention.mention.correct',
  'api::mention.mention.replay',
  'api::dead-letter.dead-letter.replay',
  'api::mention.mention.draft',
  'api::response.response.find',
  'api::response.response.findOne',
  'api::response.response.create',
  'api::response.response.outcome',
  'api::mention.mention.refine',
  'api::mcp-server.mcp-server.list',
  'api::mcp-server.mcp-server.register',
  'api::mcp-server.mcp-server.connect',
  'api::mcp-server.mcp-server.finishAuth',
  'api::mcp-server.mcp-server.test',
  'api::mcp-server.mcp-server.toggle',
  'api::mcp-server.mcp-server.remove',
  'api::person.person.leads',
  'api::person.person.detail',
  'api::person.person.status',
  'api::person.person.leadsStatus',
  'api::person.person.saveLeadProfile',
  'api::person.person.suggestIdentity',
  'api::person.person.mergeCandidates',
  'api::person.person.merge',
  'api::person.person.rescore',
  'api::muted-author.muted-author.find',
  'api::muted-author.muted-author.mute',
  'api::muted-author.muted-author.rescan',
  'api::muted-author.muted-author.unmute',
  'api::topic.topic.find',
  'api::topic.topic.findOne',
  'api::event.event.find',
  'api::event.event.findOne',
  'api::channel.channel.find',
  'api::channel.channel.findOne',
  'api::activity.activity.find',
  'api::activity.activity.findOne',
  'api::search.search.query',
  'api::insights.insights.trends',
  'api::insights.insights.themes',
  'api::insights.insights.stale',
  'api::insights.insights.snapshot',
  'api::insights.insights.leaderboard',
  'api::insights.insights.feedback',
  'api::insights.insights.graph',
  'api::event.event.add',
  'api::analysis.analysis.status',
  'api::analysis.analysis.reclassify',
  'api::preference.preference.mine',
  'api::preference.preference.updateMine',
  'api::insights.insights.config',
  'api::assistant.chat.chat',
  'plugin::octolens.sync.trigger',
  'plugin::users-permissions.user.me',
]

const DEFAULT_CHANNELS = [
  { name: 'X', key: 'x', url: 'https://x.com' },
  { name: 'Reddit', key: 'reddit', url: 'https://reddit.com' },
  { name: 'LinkedIn', key: 'linkedin', url: 'https://linkedin.com' },
  { name: 'Bluesky', key: 'bluesky', url: 'https://bsky.app' },
  { name: 'Hacker News', key: 'hackernews', url: 'https://news.ycombinator.com' },
  { name: 'YouTube', key: 'youtube', url: 'https://youtube.com' },
]

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default {
  async register({ strapi }: { strapi: Core.Strapi }) {
    // Custom MCP tools — app-level registration (must run before mcp.start()).
    registerAllMcpTools(strapi)

    // Tool permission actions MUST register here, not in bootstrap: the admin
    // plugin's bootstrap cleanup prunes token/role grants whose action isn't in
    // the registry yet — bootstrap-time registration meant every restart wiped
    // the per-tool grants off admin tokens (verified 2026-07-28).
    await registerMcpToolPermissions(strapi)

    // uid fields are NOT auto-filled on API/seed writes (admin panel only) —
    // generate topic.slug in Document Service middleware for every write path.
    strapi.documents.use(async (context, next) => {
      if (
        context.uid === 'api::topic.topic' &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const data: any = (context.params as any)?.data
        if (data && !data.slug && data.name) data.slug = slugify(data.name) || Buffer.from(String(data.name)).toString('hex').slice(0, 24)
      }
      return next()
    })
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // ---- Repair duplicate mentions + enforce a real unique index on externalId ----
    // A failure here leaves ingest WITHOUT its race guard (and the index create
    // itself fails while duplicates remain) — alert ops, never just log.
    await dedupeMentionsAndEnforceUnique(strapi).catch(async (err: Error) => {
      strapi.log.error(`pulse: mention dedupe/unique-index FAILED — ingest race guard may be absent: ${err.message}`)
      await (strapi.service('api::notify.slack') as any)
        .ops(`mention dedupe/unique-index failed at boot: ${err.message} — duplicates may accumulate until fixed`)
        .catch(() => {})
    })

    // ---- Resolve authors to People (idempotent; only touches unlinked rows) ----
    // Non-fatal: an unresolved author costs a leads-list row, not a mention.
    await backfillPeople(strapi).catch((err: Error) => {
      strapi.log.error(`pulse: person backfill failed: ${err.message}`)
    })

    // ---- Our own handles: seed the old hardcoded list, then honour it ----
    // Seeded ONCE (a deliberate deletion must stay deleted), then any of our
    // posts a classifier flagged before the allowlist existed are put right.
    await (strapi.service('api::team-handle.team-handle') as any)
      .seedOnce(SEED_TEAM_HANDLES)
      .catch((err: Error) => strapi.log.error(`pulse: team handle seed failed: ${err.message}`))
    await reclaimOurPosts(strapi).catch((err: Error) => {
      strapi.log.error(`pulse: reclaiming our own posts failed: ${err.message}`)
    })

    // ---- Move platform identity onto SocialAccount (idempotent, phase A) ----
    // BEFORE the dedupe below, which reads accounts: on a first boot after the
    // refactor there are none until this has run. It points each account at the
    // SURVIVING person, so a tombstoned half becomes a second account rather
    // than a hidden row.
    await splitSocialAccounts(strapi).catch((err: Error) => {
      strapi.log.error(`pulse: social account split failed: ${err.message}`)
    })

    // ---- Fold split identities back together (idempotent) ----
    // Two accounts for the same presence — same handle, same channel — still
    // pointing at different people. Non-fatal: a split person is a duplicate
    // row, not lost data.
    await dedupeSplitPeople(strapi).catch((err: Error) => {
      strapi.log.error(`pulse: person dedupe failed: ${err.message}`)
    })

    // ---- Seed Authenticated role permissions (idempotent) ----
    const authRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } })
    if (authRole) {
      for (const action of AUTHENTICATED_ACTIONS) {
        const existing = await strapi
          .query('plugin::users-permissions.permission')
          .findOne({ where: { action, role: authRole.id } })
        if (!existing) {
          await strapi
            .query('plugin::users-permissions.permission')
            .create({ data: { action, role: authRole.id } })
          strapi.log.info(`pulse: seeded permission ${action}`)
        }
      }
    }
    // Public role: seed NOTHING — the ingest webhook uses auth:false + shared secret.

    // ---- Close public registration (accounts are admin-invited) ----
    const advancedStore = strapi.store({ type: 'plugin', name: 'users-permissions', key: 'advanced' })
    const advanced: any = await advancedStore.get()
    if (advanced && advanced.allow_register !== false) {
      await advancedStore.set({ value: { ...advanced, allow_register: false } })
      strapi.log.info('pulse: public registration disabled')
    }

    // ---- Seed channels (idempotent) ----
    for (const channel of DEFAULT_CHANNELS) {
      const existing = await strapi
        .documents('api::channel.channel')
        .findFirst({ filters: { key: channel.key } })
      if (!existing) {
        await strapi.documents('api::channel.channel').create({ data: channel as any })
        strapi.log.info(`pulse: seeded channel ${channel.name}`)
      }
    }

    // ---- Demo data (dev only — production starts empty by design) ----
    if (process.env.PULSE_SEED_DEMO === 'true') {
      await seedDemo(strapi)
    }
  },

  destroy() {},
}
