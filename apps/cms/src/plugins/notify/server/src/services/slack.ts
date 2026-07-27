import type { Core } from '@strapi/strapi';

/**
 * Slack notifications. Two channels: SLACK_WEBHOOK_URL (team) and
 * SLACK_OPS_WEBHOOK_URL (pipeline health). Every message deep-links back to
 * Pulse via PULSE_APP_URL. Missing env → log-and-skip (local dev works
 * without Slack).
 */

const appUrl = () => (process.env.PULSE_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

export const slack = ({ strapi }: { strapi: Core.Strapi }) => {
  const post = async (webhookUrl: string | undefined, text: string) => {
    if (!webhookUrl) {
      strapi.log.info(`[notify] (no webhook configured) ${text}`);
      return;
    }
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`slack webhook ${res.status}`);
  };

  return {
    async newMention(mention: any) {
      const spicy = mention.sentimentLabel === 'negative' ? '🔴 ' : '';
      const label = mention.sentimentLabel ?? 'unscored';
      await post(
        process.env.SLACK_WEBHOOK_URL,
        `${spicy}New mention (${label}) from @${mention.authorHandle ?? 'unknown'}: ` +
          `"${String(mention.content).slice(0, 180)}" — ${appUrl()}/mentions/${mention.documentId}`
      );
    },
    async pingAssignee({ mention, assignee, router }: { mention: any; assignee: any; router?: any }) {
      await post(
        process.env.SLACK_WEBHOOK_URL,
        `📌 ${router?.username ?? 'someone'} routed a mention to *${assignee.username}*: ` +
          `"${String(mention.content).slice(0, 140)}" — ${appUrl()}/mentions/${mention.documentId}`
      );
    },
    async staleDigest(stale: { staleAfterDays: number; mentions: any[] }) {
      if (!stale.mentions.length) return;
      const lines = stale.mentions
        .slice(0, 10)
        .map((m) => `• [${m.status}] "${String(m.content).slice(0, 80)}" — ${appUrl()}/mentions/${m.documentId}`);
      await post(
        process.env.SLACK_WEBHOOK_URL,
        `⏰ ${stale.mentions.length} mention(s) older than ${stale.staleAfterDays}d without an answer:\n` +
          lines.join('\n')
      );
    },
    async ops(message: string) {
      await post(process.env.SLACK_OPS_WEBHOOK_URL, `⚠️ [pulse-ops] ${message}`);
    },
  };
};
