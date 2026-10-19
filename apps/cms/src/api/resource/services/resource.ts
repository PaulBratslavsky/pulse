import { factories } from '@strapi/strapi'

/**
 * Pulse's own references: the subset of marketing posts the team chose to keep.
 *
 * A saved resource is a COPY of what Pulse needs (title, url, summary,
 * keywords), owned here. It survives the post changing or disappearing
 * upstream — past responses may point at it — and the refresh job only ever
 * touches rows that were saved, never the whole blog.
 */

const UID = 'api::resource.resource'
const PUBLIC_FIELDS = [
  'kind', 'title', 'url', 'summary', 'keywords', 'category', 'postedAt',
  'note', 'pinned', 'hidden', 'upstreamMissing', 'refreshedAt', 'createdAt',
]

export default factories.createCoreService(UID, ({ strapi }) => {
  const source = () => strapi.service('api::resource.source') as any
  const docs = () => strapi.documents(UID) as any

  return {
    /** Saved resources, pinned first then newest saved. `q` matches title, summary, keywords and the post's opening. */
    async listSaved({ q, includeHidden = false }: { q?: string; includeHidden?: boolean } = {}) {
      const term = q?.trim()
      const filters: any = { kind: 'blog' }
      if (!includeHidden) filters.hidden = false
      if (term) {
        filters.$or = [
          { title: { $containsi: term } },
          { summary: { $containsi: term } },
          { searchText: { $containsi: term } },
        ]
      }
      return docs().findMany({
        filters,
        fields: PUBLIC_FIELDS,
        populate: { savedBy: { fields: ['username'] } },
        sort: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        limit: 200,
      })
    },

    /** sourceId → documentId for the ones already saved, so search results can say so. */
    async savedSourceIds(sourceIds: string[]): Promise<Map<string, string>> {
      if (!sourceIds.length) return new Map()
      const rows = (await strapi.db.query(UID).findMany({
        where: { sourceId: { $in: sourceIds } },
        select: ['sourceId', 'documentId'],
      })) as any[]
      return new Map(rows.map((r) => [r.sourceId, r.documentId]))
    },

    /**
     * Save a marketing post as a Pulse resource. Re-reads the post from the
     * source rather than trusting what the browser sent, so the stored copy is
     * the real published post. Idempotent: saving twice returns the same row
     * (un-hiding it if it had been hidden).
     */
    async save({ sourceId, note }: { sourceId: string; note?: string }, userId?: number) {
      const existing = await docs().findFirst({ filters: { sourceId }, fields: PUBLIC_FIELDS })
      if (existing) {
        if (!existing.hidden) return existing
        return docs().update({ documentId: existing.documentId, data: { hidden: false }, fields: PUBLIC_FIELDS })
      }
      const post = await source().get(sourceId)
      if (!post) return null
      return docs().create({
        data: { ...post, note: note?.trim() || null, savedBy: userId ?? null, refreshedAt: new Date().toISOString() },
        fields: PUBLIC_FIELDS,
      })
    },

    /** The team's own fields only — the copied post fields are the refresh job's. */
    async patch(documentId: string, data: { pinned?: unknown; hidden?: unknown; note?: unknown }) {
      const allowed: any = {}
      if (typeof data.pinned === 'boolean') allowed.pinned = data.pinned
      if (typeof data.hidden === 'boolean') allowed.hidden = data.hidden
      if (data.note === null || typeof data.note === 'string') allowed.note = (data.note as string | null)?.trim() || null
      return docs().update({ documentId, data: allowed, fields: PUBLIC_FIELDS })
    },

    async remove(documentId: string) {
      return docs().delete({ documentId })
    },

    /**
     * Re-read every saved post from the source: pick up title and summary
     * edits, and flag (never delete) posts that were unpublished upstream.
     */
    async refresh() {
      if (!source().configured()) return null
      const rows = (await strapi.db.query(UID).findMany({
        where: { kind: 'blog', sourceId: { $notNull: true } },
        select: ['documentId', 'sourceId', 'sourceUpdatedAt', 'upstreamMissing'],
      })) as any[]
      const posts: Map<string, any> = await source().getMany(rows.map((r) => r.sourceId))
      const now = new Date().toISOString()
      const counts = { checked: rows.length, updated: 0, missing: 0, failed: 0 }

      for (const row of rows) {
        if (!posts.has(row.sourceId)) {
          counts.failed++ // could not load — leave the row as it was
          continue
        }
        const post = posts.get(row.sourceId)
        if (!post) {
          if (!row.upstreamMissing) {
            await docs().update({ documentId: row.documentId, data: { upstreamMissing: true, refreshedAt: now } })
            counts.missing++
          }
          continue
        }
        const changed = toIso(post.sourceUpdatedAt) !== toIso(row.sourceUpdatedAt) || row.upstreamMissing
        await docs().update({
          documentId: row.documentId,
          data: changed ? { ...post, upstreamMissing: false, refreshedAt: now } : { refreshedAt: now },
        })
        if (changed) counts.updated++
      }
      strapi.log.info(
        `[resources] refreshed ${counts.checked} saved post(s): ${counts.updated} updated, ${counts.missing} gone upstream, ${counts.failed} failed`
      )
      return counts
    },
  }
})

const toIso = (d: unknown) => (d ? new Date(d as any).toISOString() : null)
