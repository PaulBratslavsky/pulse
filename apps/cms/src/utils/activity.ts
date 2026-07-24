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

export async function logActivity(
  strapi: Core.Strapi,
  params: {
    mentionDocumentId: string
    action: ActivityAction
    actorId?: number | null
    detail?: Record<string, unknown>
  }
) {
  await strapi.documents('api::activity.activity').create({
    data: {
      mention: params.mentionDocumentId,
      actor: params.actorId ?? null,
      action: params.action,
      detail: (params.detail ?? {}) as any,
      at: new Date().toISOString(),
    } as any,
  })
}
