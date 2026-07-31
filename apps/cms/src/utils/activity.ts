import type { Core } from '@strapi/strapi'

export type ActivityAction =
  | 'ingested'
  | 'analyzed'
  | 'claimed'
  | 'routed'
  | 'corrected'
  | 'answered'
  | 'resolved'
  | 'replayed'
  | 'acknowledged'
  | 'noted'
  | 'drafted'
  // person-scoped. The leaderboard's CATEGORY map ignores unknown actions, so
  // these are additive and cannot corrupt the existing per-user stats.
  | 'person-status'
  | 'person-scored'
  | 'person-merged'

export async function logActivity(
  strapi: Core.Strapi,
  params: {
    /** omit for a person-scoped entry — the relation is optional on both sides */
    mentionDocumentId?: string | null
    personDocumentId?: string | null
    action: ActivityAction
    actorId?: number | null
    detail?: Record<string, unknown>
  }
) {
  await strapi.documents('api::activity.activity').create({
    data: {
      mention: params.mentionDocumentId ?? null,
      person: params.personDocumentId ?? null,
      actor: params.actorId ?? null,
      action: params.action,
      detail: (params.detail ?? {}) as any,
      at: new Date().toISOString(),
    } as any,
  })
}
