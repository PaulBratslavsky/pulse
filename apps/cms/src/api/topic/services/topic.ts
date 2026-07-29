import { factories } from '@strapi/strapi'

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** slug used for collision recovery — must match the register() middleware's
 *  generation. Non-latin names slugify to '' — fall back to a stable hex so
 *  distinct names can't all collide on the empty slug. */
export const topicSlug = (name: string): string =>
  slugify(name) || Buffer.from(name).toString('hex').slice(0, 24)

/**
 * ensure(): THE single way topics get created outside the admin panel.
 * Case-insensitive match + create-catch-refetch. The DB unique index that
 * backs the race guard is on SLUG (topics_slug_uq) — so the recovery refetch
 * matches on slug first (distinct names can collide to one slug), then name.
 *
 * ⚠️ NOT safe inside an ambient strapi.db.transaction on Postgres: a unique
 * violation aborts the whole transaction and the recovery refetch would fail
 * too. Call it BEFORE opening a transaction (as correct() does).
 */
export default factories.createCoreService('api::topic.topic', ({ strapi }) => ({
  async ensure(names: string[], kind: string = 'other'): Promise<string[]> {
    const ids: string[] = []
    for (const rawName of names) {
      const name = String(rawName).trim()
      if (!name) continue
      let topic = await strapi
        .documents('api::topic.topic')
        .findFirst({ filters: { name: { $eqi: name } } })
      if (!topic) {
        try {
          topic = await strapi
            .documents('api::topic.topic')
            .create({ data: { name, kind, slug: topicSlug(name) } as any })
          strapi.log.info(`[topics] auto-created ${kind} topic '${name}'`)
        } catch (err) {
          // lost a race OR collided on slug with a differently-named topic —
          // recover by the key the unique index actually fires on
          topic =
            (await strapi
              .documents('api::topic.topic')
              .findFirst({ filters: { slug: topicSlug(name) } })) ??
            (await strapi
              .documents('api::topic.topic')
              .findFirst({ filters: { name: { $eqi: name } } }))
          if (!topic) throw err
        }
      }
      ids.push(topic.documentId)
    }
    // case-variant inputs ('Docs','docs') resolve to the same topic — dedupe
    return [...new Set(ids)]
  },
}))
