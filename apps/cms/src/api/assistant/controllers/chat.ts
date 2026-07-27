import type { Core } from '@strapi/strapi';

export const chat = ({ strapi }: { strapi: Core.Strapi }) => ({
  async chat(ctx: any) {
    if (!(strapi.service('api::analysis.ai') as any).enabled()) {
      ctx.status = 503;
      ctx.body = {
        data: null,
        error: { status: 503, message: 'AI features are disabled — set AI_API_KEY on the backend to enable chat.' },
      };
      return;
    }
    const { messages } = ctx.request.body ?? {};
    if (!Array.isArray(messages) || !messages.length) return ctx.badRequest('messages[] required');
    const question = String(messages[messages.length - 1]?.content ?? '').slice(0, 2000);
    const result = await (strapi.service('api::assistant.answer') as any).answer(question);
    ctx.body = { data: result };
  },
});

export default chat;
