import type { Core } from '@strapi/strapi';

export const youtube = ({ strapi }: { strapi: Core.Strapi }) => ({
  /** Admin route: run the YouTube sync now. `{ uploadsLimit }` overrides the configured limit for this run. */
  async sync(ctx: any) {
    const raw = ctx.request.body?.uploadsLimit;
    const uploadsLimit = raw === undefined ? undefined : Number(raw);
    if (uploadsLimit !== undefined && (!Number.isInteger(uploadsLimit) || uploadsLimit < 1 || uploadsLimit > 5000)) {
      return ctx.badRequest('uploadsLimit must be an integer from 1 to 5000');
    }
    const result = await (strapi.plugin('brain').service('youtube') as any).sync({ uploadsLimit });
    ctx.body = { data: result };
  },
});

export default youtube;
