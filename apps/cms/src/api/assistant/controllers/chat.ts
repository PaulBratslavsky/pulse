import type { Core } from '@strapi/strapi';

export const chat = ({ strapi }: { strapi: Core.Strapi }) => ({
  async chat(ctx: any) {
    if (!(strapi.service('api::analysis.ai') as any).chatEnabled()) {
      ctx.status = 503;
      ctx.body = {
        data: null,
        error: { status: 503, message: 'AI features are disabled — set AI_API_KEY on the backend to enable chat.' },
      };
      return;
    }
    const { messages } = ctx.request.body ?? {};
    if (!Array.isArray(messages) || !messages.length) return ctx.badRequest('messages[] required');
    // The WHOLE conversation, not just the last line. This used to take
    // messages[messages.length - 1], so the UI rendered a conversation the
    // server could not remember and every follow-up started from nothing.
    const result = await (strapi.service('api::assistant.answer') as any).answer(messages);
    ctx.body = { data: result };
  },
});

export default chat;
