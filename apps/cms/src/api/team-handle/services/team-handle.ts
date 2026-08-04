import { factories } from '@strapi/strapi'

/**
 * Which handles are OURS.
 *
 * This used to be a hardcoded Set in person.ts, which meant a new teammate — or
 * a second handle for an existing one — needed a deploy. Worse, the list was
 * only ever consulted to derive `kind`, and nothing downstream acted on it: our
 * own posts could still be flagged as suspected spam by the classifier, which
 * is exactly what happened to a Reddit comment recommending Strapi.
 *
 * Cached because it is read on the ingest path for every mention and changes
 * about twice a year. The TTL is short enough that adding a handle in the admin
 * takes effect while you are still looking at the screen.
 */
const TTL_MS = 60 * 1000
let cache: { at: number; handles: Set<string> } | null = null

export const normalizeHandle = (h?: string | null) =>
  (h ?? '').trim().replace(/^@+/, '').toLowerCase()

export default factories.createCoreService('api::team-handle.team-handle', ({ strapi }) => ({
  /** Invalidate after a write, so the admin panel feels immediate. */
  invalidate() {
    cache = null
  },

  async handles(): Promise<Set<string>> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.handles
    let rows: any[] = []
    try {
      rows = await strapi.documents('api::team-handle.team-handle').findMany({ limit: 500 })
    } catch {
      // Table missing on a first boot before sync — an empty allowlist is the
      // safe answer: it flags nothing extra, it just fails to protect.
      return new Set()
    }
    const handles = new Set(rows.map((r: any) => normalizeHandle(r.handle)).filter(Boolean))
    cache = { at: Date.now(), handles }
    return handles
  },

  async isOurs(handle?: string | null): Promise<boolean> {
    const h = normalizeHandle(handle)
    if (!h) return false
    return (await this.handles()).has(h)
  },

  /**
   * Seed the handles that used to be hardcoded, once.
   *
   * Idempotent and additive: it never re-creates a row someone deleted on
   * purpose, because a deliberate removal is a decision and re-adding it every
   * boot would silently overrule it.
   */
  async seedOnce(defaults: { handle: string; kind: string }[]) {
    const marker = await strapi.store({ type: 'plugin', name: 'pulse', key: 'team-handles-seeded' })
    if (await marker.get()) return 0
    let created = 0
    for (const d of defaults) {
      const handle = normalizeHandle(d.handle)
      const existing = await strapi
        .documents('api::team-handle.team-handle')
        .findFirst({ filters: { handle } as any })
      if (existing) continue
      await strapi
        .documents('api::team-handle.team-handle')
        .create({ data: { handle, kind: d.kind, note: 'seeded from the previous hardcoded list' } as any })
      created++
    }
    await marker.set({ value: true })
    this.invalidate()
    if (created) strapi.log.info(`pulse: seeded ${created} team handle(s)`)
    return created
  },
}))
