/**
 * Pulse background jobs (build spec):
 * - every minute: analyze pending/failed mentions (webhook stores only — no AI in-request)
 * - 03:00 UTC: topic re-cluster (skipped when AI budget exhausted; never touches humanCorrected)
 * - 09:00 UTC weekdays: stale digest to Slack
 * - midnight UTC: reset the daily AI token counter
 * Errors surface in the ops Slack channel — the pipeline never fails silently.
 */
export default {
  analysisSweep: {
    task: async ({ strapi }: any) => {
      try {
        await strapi.service('api::analysis.sweep').run()
      } catch (err: any) {
        strapi.log.error(`[cron] analysis sweep crashed: ${err.message}`)
        await strapi.service('api::notify.slack').ops(`analysis sweep crashed: ${err.message}`).catch(() => {})
      }
    },
    options: { rule: '* * * * *' },
  },
  nightlyRecluster: {
    task: async ({ strapi }: any) => {
      try {
        const n = await strapi.service('api::analysis.sweep').recluster()
        strapi.log.info(`[cron] recluster queued ${n} mention(s)`)
      } catch (err: any) {
        await strapi.service('api::notify.slack').ops(`recluster crashed: ${err.message}`).catch(() => {})
      }
    },
    options: { rule: '0 3 * * *' },
  },
  staleDigest: {
    task: async ({ strapi }: any) => {
      try {
        const stale = await strapi.service('api::analysis.insights').stale({})
        await strapi.service('api::notify.slack').staleDigest(stale)
      } catch (err: any) {
        await strapi.service('api::notify.slack').ops(`stale digest crashed: ${err.message}`).catch(() => {})
      }
    },
    options: { rule: '0 9 * * 1-5' },
  },
  budgetReset: {
    task: async ({ strapi }: any) => {
      await strapi.service('api::analysis.budget').reset()
    },
    options: { rule: '0 0 * * *' },
  },
  // Octolens pull-sync — the PRIMARY ingestion path (user decision: all Octolens
  // integration lives in the Strapi backend; no frontend relay). The direct
  // webhook remains ready at /api/ingest/octolens for when Octolens fixes their
  // SSRF false-positive on Cloudflare's 172.66/16. Until then this cadence is
  // the freshness ceiling. No-op when no OCTOLENS_API key is configured.
  octolensSync: {
    task: async ({ strapi }: any) => {
      try {
        await strapi.service('api::ingest.octolens-sync').sync({ lookbackHours: 24 })
      } catch (err: any) {
        strapi.log.error(`[cron] octolens sync crashed: ${err.message}`)
        await strapi.service('api::notify.slack').ops(`octolens sync crashed: ${err.message}`).catch(() => {})
      }
    },
    options: { rule: process.env.OCTOLENS_SYNC_CRON || '*/5 * * * *' },
  },
}
