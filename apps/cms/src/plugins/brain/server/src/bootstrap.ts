import type { Core } from '@strapi/strapi';

/**
 * The daily YouTube sync. OFF unless BRAIN_YOUTUBE_SYNC=true (checked on each
 * run), so a fresh checkout or a staging copy never spends the API quota by
 * accident, and a logged no-op without YOUTUBE_API_KEY. ~35 quota units a run
 * of 10,000 a day. 05:00 UTC by default, after the night's other jobs;
 * BRAIN_YOUTUBE_SYNC_CRON overrides it. Needs Strapi's cron
 * (`server.cron.enabled`).
 *
 * A crash is logged, and posted to the host app's ops channel when the host
 * has one (Pulse's `api::notify.slack`); the plugin doesn't depend on it.
 */
const syncTask = async ({ strapi }: { strapi: Core.Strapi }) => {
  if (process.env.BRAIN_YOUTUBE_SYNC !== 'true') return;
  try {
    await (strapi.plugin('brain').service('youtube') as any).sync();
  } catch (err: any) {
    strapi.log.error(`[brain] youtube sync crashed: ${err.message}`);
    await (strapi.plugin('brain').service('youtube') as any).recordRun({ at: new Date().toISOString(), crashed: err.message });
    try {
      const slack: any = strapi.service('api::notify.slack' as any);
      await slack?.ops?.(`brain youtube sync crashed: ${err.message}`);
    } catch {
      /* no ops channel in this host app, or Slack is down: the log line stands */
    }
  }
};

/**
 * Seed the phase-1 channels into an empty table, and schedule the sync. The
 * seed is non-fatal: a failed seed costs a manual entry in the Content
 * Manager, never the boot.
 */
export const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  await (strapi.plugin('brain').service('youtube') as any)
    .seedChannels()
    .catch((err: Error) => strapi.log.error(`[brain] channel seed failed: ${err.message}`));

  strapi.cron.add({
    brainYoutubeSync: { task: syncTask, options: { rule: process.env.BRAIN_YOUTUBE_SYNC_CRON || '0 5 * * *' } },
  });
};
