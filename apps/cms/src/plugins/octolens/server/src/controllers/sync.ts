import type { Core } from '@strapi/strapi';

export const sync = ({ strapi }: { strapi: Core.Strapi }) => ({
  /** Content-API: authenticated team members (frontend/curl). `{ lookbackHours }` for backfill. */
  async trigger(ctx: any) {
    const lookbackHours = Math.min(Number(ctx.request.body?.lookbackHours ?? 24), 24 * 365);
    if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) return ctx.badRequest('invalid lookbackHours');
    const result = await (strapi.plugin('octolens').service('sync') as any).sync({ lookbackHours });
    ctx.body = { data: { lookbackHours, ...result } };
  },

  /** Admin route: powers the Sync Now button + widget in the admin panel. */
  async adminTrigger(ctx: any) {
    const lookbackHours = Math.min(Number(ctx.request.body?.lookbackHours ?? 24), 24 * 365);
    if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) return ctx.badRequest('invalid lookbackHours');
    const service = strapi.plugin('octolens').service('sync') as any;
    const result = await service.sync({ lookbackHours });
    ctx.body = { data: { lookbackHours, enabled: service.enabled(), ...result } };
  },

  /** Admin route: status for the admin page/widget. */
  async status(ctx: any) {
    const enabled = (strapi.plugin('octolens').service('sync') as any).enabled();
    const total = await strapi.documents('api::mention.mention').count({});
    const latest = await strapi.documents('api::mention.mention').findFirst({
      sort: 'receivedAt:desc' as any,
      fields: ['receivedAt'] as any,
    });
    ctx.body = { data: { enabled, totalMentions: total, lastReceivedAt: latest?.receivedAt ?? null } };
  },
});

export default sync;
