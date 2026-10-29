import type { Core } from '@strapi/strapi'
import { seedDemo } from './seed-demo'
import { registerAllMcpTools, registerMcpToolPermissions } from './mcp'
import { dedupeMentionsAndEnforceUnique } from './utils/dedupe-mentions'
import { dedupeSplitPeople } from './utils/dedupe-people'
import { splitSocialAccounts } from './utils/split-social-accounts'
import { SEED_TEAM_HANDLES } from './api/person/services/person'
import { reclaimOurPosts } from './utils/reclaim-our-posts'
import { backfillThreadKeys } from './utils/backfill-threads'
import { refreshAllThreads } from './utils/thread-state'
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
  'api::mention.mention.thread',
  'api::mention.mention.correct',
  'api::mention.mention.replay',
  'api::dead-letter.dead-letter.replay',
  'api::mention.mention.draft',
  'api::response.response.find',
  'api::response.response.findOne',
  'api::response.response.create',
  'api::response.response.update',
  'api::response.response.delete',
  'api::response.response.outcome',
  'api::mention.mention.refine',
  'api::mention.mention.draftChat',
  'api::mcp-server.mcp-server.list',
  'api::mcp-server.mcp-server.test',
  'api::person.person.leads',
  'api::person.person.directory',
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
  'api::muted-topic.muted-topic.find',
  'api::muted-topic.muted-topic.mute',
  'api::muted-topic.muted-topic.unmute',
  'api::muted-topic.muted-topic.rescan',
  'api::muted-topic.muted-topic.suggestions',
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
  'api::resource.resource.list',
  'api::resource.resource.save',
  'api::resource.resource.patch',
  'api::resource.resource.remove',
  'api::resource.resource.searchSource',
  'api::resource.resource.refresh',
  'api::resource.resource.forMention',
  'api::resource.resource.sharedBefore',
  'plugin::users-permissions.user.me',
  // READ on the targets of the mention detail populate. Since Strapi 5.52 the
  // content API strips any populated relation whose target the caller cannot
  // `find`, silently: a mention arrived without its person, comments, reply
  // author or activity actor (claims, timeline and "Edit" all broke). person
  // and comment register no core find route, so these grant no new endpoint;
  // user.find does open GET /api/users to signed-in team members, which is
  // acceptable for an invite-only staff tool.
  'api::person.person.find',
  'api::comment.comment.find',
  'plugin::users-permissions.user.find',
]

/** The value apps/cms/.env.example ships with — public, so never a production secret. */
const DEV_WEBHOOK_SECRET = 'dev-secret-123'

/**
 * Changing the SHARED MCP servers — which servers exist, their tokens, and
 * whether the AI may call them — is for Pulse admins only. One member account
 * (or a script running in one member's browser) could otherwise repoint a token
 * or give every teammate's drafter a hostile server.
 */
const MCP_ADMIN_ACTIONS = [
  'api::mcp-server.mcp-server.register',
  'api::mcp-server.mcp-server.connect',
  'api::mcp-server.mcp-server.finishAuth',
  'api::mcp-server.mcp-server.toggle',
  'api::mcp-server.mcp-server.remove',
  'api::mcp-server.mcp-server.setToken',
  'api::mcp-server.mcp-server.setPurpose',
]

export const PULSE_ADMIN_ROLE = 'pulse-admin'

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

    // ---- Group mentions into conversations (idempotent, derived from URLs) ----
    await backfillThreadKeys(strapi).catch((err: Error) => {
      strapi.log.error(`pulse: thread backfill failed: ${err.message}`)
    })
    // ...then work out which of those conversations are waiting on us
    await refreshAllThreads(strapi).catch((err: Error) => {
      strapi.log.error(`pulse: awaiting-reply refresh failed: ${err.message}`)
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

    // ---- Seed role permissions (idempotent) ----
    // Authenticated = every team member. Pulse admin = the same, plus managing
    // the shared MCP servers. Grants are added if missing; the admin-only ones
    // are also REMOVED from Authenticated, where older deploys put them.
    const roles = strapi.query('plugin::users-permissions.role')
    const permissions = strapi.query('plugin::users-permissions.permission')
    const grant = async (roleId: number, actions: string[]) => {
      for (const action of actions) {
        const existing = await permissions.findOne({ where: { action, role: roleId } })
        if (!existing) {
          await permissions.create({ data: { action, role: roleId } })
          strapi.log.info(`pulse: seeded permission ${action} (role ${roleId})`)
        }
      }
    }
    const authRole = await roles.findOne({ where: { type: 'authenticated' } })
    if (authRole) {
      await grant(authRole.id, AUTHENTICATED_ACTIONS)
      const revoked = await permissions.deleteMany({ where: { role: authRole.id, action: { $in: MCP_ADMIN_ACTIONS } } })
      if (revoked?.count) strapi.log.info(`pulse: MCP server management is now admin-only (${revoked.count} grants removed from Authenticated)`)
    }
    let adminRole = await roles.findOne({ where: { type: PULSE_ADMIN_ROLE } })
    if (!adminRole) {
      adminRole = await roles.create({
        data: {
          name: 'Pulse admin',
          description: 'Team member who can also manage the shared MCP servers',
          type: PULSE_ADMIN_ROLE,
        },
      })
      strapi.log.info('pulse: created the "Pulse admin" role')
    }
    await grant(adminRole.id, [...AUTHENTICATED_ACTIONS, ...MCP_ADMIN_ACTIONS])

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

    // ---- Blog search: env-configured marketing site → a Settings entry, once ----
    // Non-blocking: connecting reaches the network, and boot must not wait on it.
    void (strapi.service('api::mcp-server.mcp-server') as any)
      .seedResourcesFromEnv()
      .catch((err: Error) => strapi.log.warn(`pulse: seeding the marketing MCP server failed: ${err.message}`))

    // ---- Demo data (dev only — production starts empty by design) ----
    // The demo users have a documented password, so production never seeds
    // them, whatever the env says.
    if (process.env.PULSE_SEED_DEMO === 'true') {
      if (process.env.NODE_ENV === 'production') {
        strapi.log.error('pulse: PULSE_SEED_DEMO is set in production — ignored (demo users have a public password)')
      } else {
        await seedDemo(strapi)
      }
    }

    // ---- Pulse admins named in PULSE_ADMIN_EMAILS (promote only, never demote) ----
    // After the demo seed, which is what creates the demo admin on a fresh database.
    // Admins can also be set by hand in the admin panel (Content Manager → User →
    // role); removing someone from the list does not demote them.
    const adminEmails = String(process.env.PULSE_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    for (const email of adminEmails) {
      const user = await strapi
        .query('plugin::users-permissions.user')
        .findOne({ where: { email }, populate: ['role'] })
      if (user && user.role?.type === 'authenticated') {
        await strapi.query('plugin::users-permissions.user').update({ where: { id: user.id }, data: { role: adminRole.id } })
        strapi.log.info(`pulse: ${email} is now a Pulse admin`)
      }
    }

    // ---- The webhook secret must not be the one in .env.example ----
    // Warn, never refuse: refusing would stop live ingest, and the secret is
    // rotated on Octolens' side as well as here.
    if (process.env.NODE_ENV === 'production' && process.env.OCTOLENS_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
      strapi.log.error('pulse: OCTOLENS_WEBHOOK_SECRET is the public .env.example value — rotate it')
      await (strapi.service('api::notify.slack') as any)
        .ops('OCTOLENS_WEBHOOK_SECRET in production is the public .env.example value — rotate it in Octolens and Strapi Cloud')
        .catch(() => {})
    }
  },

  destroy() {},
}
