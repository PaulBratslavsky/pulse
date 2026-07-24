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
        await strapi.plugin('analysis').service('sweep').run()
      } catch (err: any) {
        strapi.log.error(`[cron] analysis sweep crashed: ${err.message}`)
        await strapi.plugin('notify').service('slack').ops(`analysis sweep crashed: ${err.message}`).catch(() => {})
      }
    },
    options: { rule: '* * * * *' },
  },
  nightlyRecluster: {
    task: async ({ strapi }: any) => {
      try {
        const n = await strapi.plugin('analysis').service('sweep').recluster()
        strapi.log.info(`[cron] recluster queued ${n} mention(s)`)
      } catch (err: any) {
        await strapi.plugin('notify').service('slack').ops(`recluster crashed: ${err.message}`).catch(() => {})
      }
    },
    options: { rule: '0 3 * * *' },
  },
  staleDigest: {
    task: async ({ strapi }: any) => {
      try {
        const stale = await strapi.plugin('analysis').service('insights').stale({})
        await strapi.plugin('notify').service('slack').staleDigest(stale)
      } catch (err: any) {
        await strapi.plugin('notify').service('slack').ops(`stale digest crashed: ${err.message}`).catch(() => {})
      }
    },
    options: { rule: '0 9 * * 1-5' },
  },
  budgetReset: {
    task: async ({ strapi }: any) => {
      await strapi.plugin('analysis').service('budget').reset()
    },
    options: { rule: '0 0 * * *' },
  },
}
