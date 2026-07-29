import { factories } from '@strapi/strapi'
import { logActivity } from '../../../utils/activity'
import { WorkflowError } from '../../../utils/workflow-error'

/**
 * Mention workflow — the state machine from docs/architecture.md, executable.
 * Every transition: guard on the current status → writes inside ONE
 * transaction (Document Service joins the ambient strapi.db.transaction) →
 * activity logged atomically with the change. Side effects (Slack) run after
 * commit, fire-and-forget. Controllers and future agent tools call these
 * methods — they never hand-roll transitions.
 *
 * Legal sources per action (everything else → 409):
 *   claim        ← unanswered            (no silent takeover of claimed/closed)
 *   acknowledge  ← unanswered | claimed
 *   answer       ← any status            (a real reply always counts; it re-opens
 *                                         acknowledged/resolved into 'answered')
 *   resolve      ← answered              (outcome of a PUBLIC reply only)
 */
const CLAIM_SOURCES = ['unanswered']
const ACK_SOURCES = ['unanswered', 'claimed']
const ACK_REASONS = ['competitor', 'not-relevant', 'watching', 'own-post']
const TEAMS = ['devrel', 'marketing', 'product']
const SENTIMENTS = ['positive', 'neutral', 'negative', 'na']

export default factories.createCoreService('api::mention.mention', ({ strapi }) => ({
  async requireMention(documentId: string, populate?: any) {
    const mention = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId, ...(populate ? { populate } : {}) })
    if (!mention) throw new WorkflowError(404, 'mention not found')
    return mention as any
  },

  /** Row-lock + status re-check INSIDE the transaction — the guard must be
   *  race-proof, not advisory (two concurrent claims must not both succeed).
   *  forUpdate() locks on Postgres; SQLite's single writer serializes anyway. */
  async lockAndGuard(trx: any, documentId: string, sources: string[] | null, action: string) {
    const row = await trx('mentions').where({ document_id: documentId }).forUpdate().first()
    if (!row) throw new WorkflowError(404, 'mention not found')
    if (sources && !sources.includes(row.status))
      throw new WorkflowError(409, `cannot ${action} a '${row.status}' mention`)
    return row
  },

  async claim(documentId: string, user: { id: number }) {
    return strapi.db.transaction(async ({ trx }: any) => {
      const row = await this.lockAndGuard(trx, documentId, CLAIM_SOURCES, 'claim')
      const updated = await strapi.documents('api::mention.mention').update({
        documentId,
        data: { owner: user.id, status: 'claimed' } as any,
      })
      await logActivity(strapi, {
        mentionDocumentId: documentId,
        action: 'claimed',
        actorId: user.id,
        detail: { from: row.status, to: 'claimed' },
      })
      return updated
    })
  },

  async acknowledge(documentId: string, user: { id: number }, { reason, note }: any) {
    if (!ACK_REASONS.includes(reason)) throw new WorkflowError(400, 'invalid reason')
    return strapi.db.transaction(async ({ trx }: any) => {
      const row = await this.lockAndGuard(trx, documentId, ACK_SOURCES, 'acknowledge')
      const updated = await strapi.documents('api::mention.mention').update({
        documentId,
        data: { status: 'acknowledged', acknowledgeReason: reason } as any,
      })
      await logActivity(strapi, {
        mentionDocumentId: documentId,
        action: 'acknowledged',
        actorId: user.id,
        detail: { from: row.status, reason, note: note || null },
      })
      return updated
    })
  },

  async route(documentId: string, user: { id: number }, { suggestedTeam, assigneeId }: any) {
    const mention = await this.requireMention(documentId)
    const data: Record<string, unknown> = {}
    if (suggestedTeam) {
      if (!TEAMS.includes(suggestedTeam)) throw new WorkflowError(400, 'invalid suggestedTeam')
      data.suggestedTeam = suggestedTeam
    }
    let assignee: any = null
    if (assigneeId) {
      assignee = await strapi
        .query('plugin::users-permissions.user')
        .findOne({ where: { id: assigneeId } })
      if (!assignee) throw new WorkflowError(400, 'assignee not found')
      data.assignee = assignee.id
    }
    if (!Object.keys(data).length) throw new WorkflowError(400, 'nothing to route')

    const updated = await strapi.db.transaction(async () => {
      const u = await strapi.documents('api::mention.mention').update({ documentId, data: data as any })
      await logActivity(strapi, {
        mentionDocumentId: documentId,
        action: 'routed',
        actorId: user.id,
        detail: { suggestedTeam: suggestedTeam ?? null, assignee: assignee?.username ?? null },
      })
      return u
    })
    if (assignee) {
      await (strapi.service('api::notify.slack') as any)
        .pingAssignee({ mention, assignee, router: user })
        .catch((err: Error) => strapi.log.warn(`assignee ping failed: ${err.message}`))
    }
    return updated
  },

  async correct(documentId: string, user: { id: number }, { sentimentLabel, sentimentScore, topicIds, newTopics }: any) {
    const mention = await this.requireMention(documentId, { topics: true })
    const before = {
      sentimentLabel: mention.sentimentLabel,
      sentimentScore: mention.sentimentScore,
      topics: (mention.topics ?? []).map((t: any) => t.name),
    }
    const data: Record<string, unknown> = { humanCorrected: true }
    if (sentimentLabel) {
      if (!SENTIMENTS.includes(sentimentLabel)) throw new WorkflowError(400, 'invalid sentimentLabel')
      data.sentimentLabel = sentimentLabel
      // n/a = not about Strapi — clear the score so trends/Pulse ignore it
      if (sentimentLabel === 'na') data.sentimentScore = null
    }
    if (typeof sentimentScore === 'number') {
      if (sentimentScore < -1 || sentimentScore > 1) throw new WorkflowError(400, 'score out of range')
      data.sentimentScore = sentimentScore
    }
    // topic creation is idempotent/race-safe — deliberately OUTSIDE the transaction
    const createdTopicIds: string[] =
      Array.isArray(newTopics) && newTopics.length
        ? await (strapi.service('api::topic.topic') as any).ensure(
            newTopics.slice(0, 10).map((n: unknown) => String(n).trim().slice(0, 80)),
            'other'
          )
        : []
    if (Array.isArray(topicIds) || createdTopicIds.length)
      data.topics = [...new Set([...(Array.isArray(topicIds) ? topicIds : []), ...createdTopicIds])]

    return strapi.db.transaction(async () => {
      const updated = await strapi.documents('api::mention.mention').update({ documentId, data: data as any })
      await logActivity(strapi, {
        mentionDocumentId: documentId,
        action: 'corrected',
        actorId: user.id,
        detail: { before, after: { sentimentLabel, sentimentScore, topicIds, newTopics: newTopics ?? null } },
      })
      return updated
    })
  },

  /**
   * Bulk triage: run a per-item workflow method across a selection. Each item
   * keeps its OWN guard + transaction (so one illegal transition can't roll
   * back the rest) and reports individually — the UI shows what actually
   * happened rather than a single opaque success/failure.
   */
  async bulk(
    action: 'acknowledge' | 'claim' | 'correct',
    documentIds: string[],
    user: { id: number },
    payload: any = {}
  ) {
    if (!Array.isArray(documentIds) || !documentIds.length)
      throw new WorkflowError(400, 'documentIds[] is required')
    if (documentIds.length > 200) throw new WorkflowError(400, 'max 200 mentions per bulk call')

    // topics are ensured ONCE for the whole batch (race-safe, outside the
    // per-item transactions) instead of per mention
    let sharedTopicIds: string[] | undefined
    if (action === 'correct' && Array.isArray(payload.newTopics) && payload.newTopics.length) {
      sharedTopicIds = await (strapi.service('api::topic.topic') as any).ensure(
        payload.newTopics.slice(0, 10).map((n: unknown) => String(n).trim().slice(0, 80)),
        'other'
      )
    }

    const results: Array<{ documentId: string; ok: boolean; error?: string; status?: number }> = []
    for (const documentId of documentIds) {
      try {
        if (action === 'claim') await this.claim(documentId, user)
        else if (action === 'acknowledge') await this.acknowledge(documentId, user, payload)
        else
          await this.correct(documentId, user, {
            ...payload,
            newTopics: undefined,
            topicIds: [...(payload.topicIds ?? []), ...(sharedTopicIds ?? [])],
          })
        results.push({ documentId, ok: true })
      } catch (err: any) {
        results.push({ documentId, ok: false, error: err.message, status: err.status ?? 500 })
      }
    }
    return {
      action,
      requested: documentIds.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    }
  },

  /**
   * Manual spam judgement. Heuristics only ever mark `suspected-spam` at
   * intake; this is how a human (or an agent via MCP) confirms it, flags
   * something the heuristics missed, or clears a false positive. Muting the
   * author remains the stronger action — it applies retroactively and to
   * everything they post next.
   */
  async setQuality(
    documentId: string,
    user: { id: number },
    quality: string,
    reason?: string | null,
    via = 'app'
  ) {
    if (!['normal', 'suspected-spam', 'spam'].includes(quality))
      throw new WorkflowError(400, 'invalid quality')
    const mention = await this.requireMention(documentId)
    // reason/via are the audit trail: a flag that can't say WHY forces whoever
    // confirms it to re-judge from scratch, and leaves no way to tell whether
    // the rubric behind a batch of agent flags is any good
    const clean = typeof reason === 'string' ? reason.trim().slice(0, 500) || null : null
    return strapi.db.transaction(async () => {
      const updated = await strapi.documents('api::mention.mention').update({
        documentId,
        data: {
          quality,
          // clearing the flag clears its rationale — a stale reason must never
          // outlive the judgement it explained
          qualityReason: quality === 'normal' ? null : clean,
          qualityVia: quality === 'normal' ? null : via,
        } as any,
      })
      await logActivity(strapi, {
        mentionDocumentId: documentId,
        action: 'corrected',
        actorId: user?.id ?? null,
        detail: {
          quality: { from: mention.quality ?? 'normal', to: quality },
          ...(clean ? { reason: clean } : {}),
          via,
        },
      })
      return updated
    })
  },

  async replay(documentId: string, user: { id: number }) {
    const mention = await this.requireMention(documentId)
    if (!mention.raw) throw new WorkflowError(400, 'mention has no raw payload to replay')
    return strapi.db.transaction(async () => {
      await strapi.documents('api::mention.mention').update({
        documentId,
        // reset the attempt counter — replay is the explicit un-park action
        data: { analysisStatus: 'pending', analysisAttempts: 0 } as any,
      })
      await logActivity(strapi, {
        mentionDocumentId: documentId,
        action: 'replayed',
        actorId: user.id,
        detail: { note: 'analysisStatus reset to pending; cron sweep will re-analyze (humanCorrected fields preserved)' },
      })
      return { queued: true }
    })
  },
}))
