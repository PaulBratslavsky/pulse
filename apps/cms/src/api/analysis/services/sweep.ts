import type { Core } from '@strapi/strapi';
import { aiEnabled } from './ai';

/**
 * Every-minute cron. AI enabled: analyze pending/failed (+ previously skipped —
 * auto-catch-up after a key is added). AI disabled: mark pending as 'skipped'
 * and STILL Slack-notify — ingest → queue → respond works fully without AI;
 * labeling is manual. humanCorrected fields are never overwritten.
 */

/** overlap guard: 20 sequential AI calls easily exceed the 60s cron cadence —
 *  overlapping runs double AI spend and duplicate activities/notifications
 *  (same race the octolens sync service guards against). */
let sweepRunning = false;

/** failed mentions are retried at most this many times, then parked with ONE
 *  ops alert — otherwise a permanently-failing mention (or a globally bad AI
 *  key) starves the queue and pings ops every minute forever. */
const MAX_ATTEMPTS = 5;

/** Rows worth spending a model call on. 'missing' = no score at all. */
const unclassifiedFilter = (scope: 'missing' | 'fallback') =>
  ({
    quality: { $ne: 'spam' },
    humanCorrected: { $ne: true },
    ...(scope === 'missing'
      ? { sentimentScore: { $null: true } }
      : {
          $or: [
            { sentimentScore: { $null: true } },
            { modelVersion: { $null: true } },
            { modelVersion: { $in: ['octolens', 'heuristic-v1', 'seed-demo'] } },
          ],
        }),
  }) as any;


/** Slack-notify only for fresh mentions — backfills of old content must not
 *  flood the team channel (same gate as the octolens intake). */
const NOTIFY_FRESHNESS_MS = 6 * 3600_000;
const isFresh = (m: any) =>
  Date.now() - new Date(m.postedAt ?? m.receivedAt ?? Date.now()).getTime() <= NOTIFY_FRESHNESS_MS;

export const sweep = ({ strapi }: { strapi: Core.Strapi }) => ({
  async run() {
    if (sweepRunning) {
      strapi.log.info('[analysis] sweep skipped — previous run still in progress');
      return 0;
    }
    sweepRunning = true;
    try {
      return await this.runSweep();
    } finally {
      sweepRunning = false;
    }
  },

  async runSweep() {
    const notifySlack = () => strapi.service('api::notify.slack') as any;

    if (!aiEnabled()) {
      // Keyless: adopt Octolens sentiment where the raw payload carries it
      // (modelVersion 'octolens'); otherwise mark skipped. Also rescans
      // skipped-but-unlabeled mentions so pre-feature backlogs get labeled.
      const intakeService = strapi.plugin('octolens').service('intake') as any;
      const pending = await strapi.documents('api::mention.mention').findMany({
        filters: {
          $or: [
            { analysisStatus: 'pending' },
            { analysisStatus: 'skipped', sentimentLabel: { $null: true } },
          ],
        } as any,
        limit: 50,
        sort: 'receivedAt:asc' as any,
      });
      for (const mention of pending) {
        const octolens = intakeService.octolensSentiment(mention.raw);
        if (octolens) {
          const updated = await strapi.documents('api::mention.mention').update({
            documentId: mention.documentId,
            data: {
              analysisStatus: 'analyzed',
              sentimentLabel: octolens.label,
              sentimentScore: octolens.score,
              modelVersion: 'octolens',
              promptVersion: 'label-map-v1',
            } as any,
          });
          await strapi.documents('api::activity.activity').create({
            data: {
              mention: mention.documentId,
              action: 'analyzed',
              detail: { modelVersion: 'octolens', label: octolens.label },
              at: new Date().toISOString(),
            } as any,
          });
          if (mention.analysisStatus === 'pending' && isFresh(mention)) {
            await notifySlack().newMention(updated).catch(() => {});
          }
        } else if (mention.analysisStatus === 'pending') {
          const updated = await strapi.documents('api::mention.mention').update({
            documentId: mention.documentId,
            data: { analysisStatus: 'skipped' } as any,
          });
          if (isFresh(mention)) await notifySlack().newMention(updated).catch(() => {});
        }
      }
      return pending.length;
    }

    // Stop before spending, not after. The budget was only ever consulted by
    // recluster, so classification had no ceiling at all — one bad loop could
    // burn a month's tokens before anyone noticed.
    const budget = await (strapi.service('api::analysis.budget') as any).status();
    if (budget.exceeded) {
      strapi.log.warn(
        `[analysis] sweep skipped — daily token budget spent (${budget.spent}/${budget.budget}). Mentions stay 'pending' and resume tomorrow.`
      );
      return 0;
    }

    const pending = await strapi.documents('api::mention.mention').findMany({
      filters: {
        // confirmed spam is never worth a model call — it is already hidden
        // from the queue and every metric
        quality: { $ne: 'spam' },
        $or: [
          { analysisStatus: { $in: ['pending', 'skipped'] } },
          // failed: retry only until the attempt cap; parked rows leave the window
          {
            analysisStatus: 'failed',
            $or: [{ analysisAttempts: { $lt: MAX_ATTEMPTS } }, { analysisAttempts: { $null: true } }],
          },
        ],
      } as any,
      // person: the lane written below decides whether its author is a lead,
      // and the score cannot be refreshed without knowing who that is
      populate: { topics: true, channel: true, person: true } as any,
      limit: 20,
      sort: 'receivedAt:asc' as any,
    });

    // The vocabulary is passed into every classification so the model reuses
    // "Docs" instead of coining "Documentation" — topic drift silently degrades
    // every theme report and the whole conversation map.
    const vocabulary: string[] = (
      await strapi.documents('api::topic.topic').findMany({ fields: ['name'], limit: 60, sort: 'name:asc' as any })
    ).map((t: any) => t.name);

    for (const mention of pending) {
      try {
        const result = await (strapi.service('api::analysis.ai') as any).analyze(mention, vocabulary);
        if (!result) continue; // key removed mid-sweep

        // single race-safe creator, case-insensitive (review: this exact-match
        // path was how 'docs' vs 'Docs' duplicated topics)
        const topicIds: string[] = await (strapi.service('api::topic.topic') as any).ensure(result.topics);

        // The model may raise 'suspected-spam' but NEVER confirm terminal
        // 'spam': that hides a mention from the queue and every metric, so it
        // stays a human decision. A false positive here costs one review; the
        // other way costs silently deleted signal.
        const flagsSpam = result.quality === 'suspected-spam' && mention.quality === 'normal';

        // humanCorrected fields are never overwritten (spec rule)
        const data: any = mention.humanCorrected
          ? { analysisStatus: 'analyzed', analysisAttempts: 0, modelVersion: result.modelVersion, promptVersion: result.promptVersion }
          : {
              analysisStatus: 'analyzed',
              analysisAttempts: 0,
              sentimentScore: result.score,
              sentimentLabel: result.label,
              topics: topicIds,
              lane: result.lane,
              laneReason: `${result.laneReason} (${result.modelVersion})`,
              // The quote was computed to gate the lane and then discarded.
              // It is the single most useful artifact for a leads workflow:
              // what a human reads before reaching out, and the only way to
              // audit whether a lead was grounded in the author's own words
              // rather than inferred. Null on a demotion, by design.
              laneEvidence: result.lane === 'lead' ? (result.laneEvidence ?? null) : null,
              leadDirection: result.leadDirection ?? 'none',
              ...(flagsSpam
                ? {
                    quality: 'suspected-spam',
                    qualityReason: result.qualityReason ?? 'flagged by automatic classification',
                    qualityVia: result.modelVersion,
                  }
                : {}),
              modelVersion: result.modelVersion,
              promptVersion: result.promptVersion,
            };
        const updated = await strapi
          .documents('api::mention.mention')
          .update({ documentId: mention.documentId, data });

        // Record where the model overturned the regex. This is the calibration
        // signal: it is the only way to tell whether the classifier is actually
        // better than the rules, rather than merely different.
        if (!mention.humanCorrected && result.lane !== mention.lane) {
          strapi.log.info(
            `[analysis] lane ${mention.lane} -> ${result.lane} for ${mention.documentId}: ${result.laneReason}`
          );
        }

        await strapi.documents('api::activity.activity').create({
          data: {
            mention: mention.documentId,
            action: 'analyzed',
            detail: {
              modelVersion: result.modelVersion,
              label: result.label,
              lane: result.lane,
              // both lanes when they differ, so the trail shows what the model
              // overturned rather than just its verdict
              ...(result.lane !== mention.lane ? { laneWas: mention.lane, laneReason: result.laneReason } : {}),
              ...(flagsSpam ? { flaggedSpam: result.qualityReason ?? true } : {}),
            },
            at: new Date().toISOString(),
          } as any,
        });
        // Re-score the author, or the leads board never learns what just
        // happened. persist() used to be reachable only through
        // POST /people/rescore, which nothing in the app calls — so a mention
        // promoted to 'lead' here left its author scoreless until someone hit
        // that endpoint by hand. It is pure arithmetic over stored rows, no
        // model call, and only a lane that touches 'lead' can change a score.
        const personId = (mention as any).person?.documentId;
        const laneNow = (updated as any).lane;
        if (personId && (laneNow === 'lead' || mention.lane === 'lead')) {
          await (strapi.service('api::person.leads') as any)
            .persist(personId)
            .catch((err: Error) =>
              // a stale score is worth less than a parked mention: never let
              // scoring failure mark a successful analysis as failed
              strapi.log.warn(`[analysis] lead rescore failed for ${personId}: ${err.message}`)
            );
        }

        if (mention.analysisStatus === 'pending' && isFresh(mention)) {
          await notifySlack().newMention(updated).catch(() => {});
        }
      } catch (err: any) {
        const attempts = ((mention as any).analysisAttempts ?? 0) + 1;
        const parked = attempts >= MAX_ATTEMPTS;
        strapi.log.error(
          `[analysis] sweep failed for ${mention.documentId} (attempt ${attempts}/${MAX_ATTEMPTS}): ${err.message}`
        );
        await strapi
          .documents('api::mention.mention')
          .update({
            documentId: mention.documentId,
            data: { analysisStatus: 'failed', analysisAttempts: attempts } as any,
          })
          .catch(() => {});
        // ONE ops alert when a mention parks — not one per minute forever
        if (parked) {
          await notifySlack()
            .ops(
              `analysis PARKED for mention ${mention.documentId} after ${attempts} attempts: ${err.message} — fix the cause, then use replay to re-queue`
            )
            .catch(() => {});
        }
      }
    }
    return pending.length;
  },

  /** Nightly: re-queue analyzed-but-topicless mentions (never touches humanCorrected). No-op when AI disabled or budget exhausted. */
  /**
   * Re-queue mentions for classification.
   *
   * Two scopes, deliberately separate:
   *  - 'missing'  — no sentiment score at all. The default, and the only thing
   *                 the button does: it never re-spends on rows that already
   *                 carry a label.
   *  - 'fallback' — additionally rows labelled by the Octolens map or the seed,
   *                 which DO have a coarse score (±0.5) but no model-assigned
   *                 lane or topics. Useful once, not on every press.
   *
   * humanCorrected is never re-queued in either scope: a person's judgement
   * outranks the model's, and re-running would spend tokens on a result we
   * then refuse to write.
   */
  async requeueUnclassified({ scope = 'missing' }: { scope?: 'missing' | 'fallback' } = {}) {
    const rows = await strapi.documents('api::mention.mention').findMany({
      filters: unclassifiedFilter(scope),
      fields: ['documentId'],
      limit: 5000,
    });
    for (const row of rows as any[]) {
      await strapi.documents('api::mention.mention').update({
        documentId: row.documentId,
        data: { analysisStatus: 'pending', analysisAttempts: 0 } as any,
      });
    }
    strapi.log.info(`[analysis] re-queued ${rows.length} mention(s) (scope: ${scope})`);
    return { requeued: rows.length, scope };
  },

  /** Both counts, so the UI can label each action with what it will actually do. */
  async unclassifiedCount() {
    const [missing, fallback] = await Promise.all([
      strapi.documents('api::mention.mention').count({ filters: unclassifiedFilter('missing') }),
      strapi.documents('api::mention.mention').count({ filters: unclassifiedFilter('fallback') }),
    ]);
    // 'fallback' is a superset of 'missing'; report the extra separately so
    // "classify 12" and "also upgrade 448" are not double-counted
    return { missing, fallbackOnly: Math.max(0, fallback - missing) };
  },

  async recluster() {
    if (!aiEnabled()) return 0;
    const { exceeded } = await (strapi.service('api::analysis.budget') as any).status();
    if (exceeded) {
      strapi.log.warn('[analysis] recluster skipped — daily AI budget exhausted');
      return 0;
    }
    const orphans = await strapi.documents('api::mention.mention').findMany({
      filters: { analysisStatus: 'analyzed', humanCorrected: false, topics: { documentId: { $null: true } } } as any,
      limit: 50,
    });
    for (const mention of orphans) {
      await strapi
        .documents('api::mention.mention')
        .update({ documentId: mention.documentId, data: { analysisStatus: 'pending' } as any });
    }
    return orphans.length;
  },
});

export default sweep;
