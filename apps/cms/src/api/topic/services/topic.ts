import { factories } from '@strapi/strapi'

/**
 * ensure(): THE single way topics get created outside the admin panel.
 * Review finding 2026-07-28: three call sites (intake competitor tagging, AI
 * sweep, mention.correct) created topics with inconsistent matching ($eqi vs
 * exact) and a racy findFirst→create. Centralized here: case-insensitive
 * match + create-catch-refetch (same race pattern as mention intake; slug's
 * unique index is the real guard).
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
          topic = await strapi.documents('api::topic.topic').create({ data: { name, kind } as any })
          strapi.log.info(`[topics] auto-created ${kind} topic '${name}'`)
        } catch (err) {
          // lost a create race — the winner's row is the one we want
          topic = await strapi
            .documents('api::topic.topic')
            .findFirst({ filters: { name: { $eqi: name } } })
          if (!topic) throw err
        }
      }
      ids.push(topic.documentId)
    }
    return ids
  },
}))
