import type { Core } from '@strapi/strapi'
import { seedDemo } from './seed-demo'
import { registerAllMcpTools } from './mcp'

/** Actions the Authenticated (team member) role gets. Each is its own permission record —
 *  a fresh Strapi denies everything for BOTH roles, and admin-UI clicks don't survive a fresh DB. */
const AUTHENTICATED_ACTIONS = [
  'api::mention.mention.find',
  'api::mention.mention.findOne',
  'api::mention.mention.claim',
  'api::mention.mention.route',
  'api::mention.mention.correct',
  'api::mention.mention.replay',
  'api::mention.mention.draft',
  'api::response.response.find',
  'api::response.response.findOne',
  'api::response.response.create',
  'api::response.response.outcome',
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
  'api::insights.insights.config',
  'api::assistant.chat.chat',
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
  register({ strapi }: { strapi: Core.Strapi }) {
    // Custom MCP tools — app-level registration (must run before mcp.start()).
    registerAllMcpTools(strapi)

    // uid fields are NOT auto-filled on API/seed writes (admin panel only) —
    // generate topic.slug in Document Service middleware for every write path.
    strapi.documents.use(async (context, next) => {
      if (
        context.uid === 'api::topic.topic' &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const data: any = (context.params as any)?.data
        if (data && !data.slug && data.name) data.slug = slugify(data.name)
      }
      return next()
    })
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
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
