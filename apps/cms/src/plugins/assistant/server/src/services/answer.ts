import type { Core } from '@strapi/strapi';

/**
 * Chat with the data: gathers a compact, structured context (Pulse score
 * trend, top themes, queue counts) and asks the AI provider. Callers gate on
 * aiEnabled — this service assumes a key is present.
 */
export const answer = ({ strapi }: { strapi: Core.Strapi }) => ({
  async answer(question: string) {
    const insights = strapi.plugin('analysis').service('insights') as any;
    const [trends, themes, unanswered] = await Promise.all([
      insights.trends({}),
      insights.themes({ days: 30 }),
      strapi.documents('api::mention.mention').count({ filters: { status: 'unanswered' } }),
    ]);
    const latest = [...trends.series].reverse().find((p: any) => p.score != null);
    const context = {
      pulseScoreToday: latest?.score ?? null,
      unansweredCount: unanswered,
      topThemes30d: themes.themes.slice(0, 5).map((t: any) => ({
        name: t.topic.name,
        mentions: t.mentions,
        negativeShare: t.negativeShare,
      })),
      recentEvents: trends.events.slice(-5),
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.AI_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-sonnet-5',
        max_tokens: 800,
        system:
          "You are Pulse, the Strapi team's mention-sentiment assistant. Answer questions about the " +
          'data using ONLY the JSON context provided. Be concise; give numbers; note when the context ' +
          'cannot answer the question.',
        messages: [{ role: 'user', content: `Context: ${JSON.stringify(context)}\n\nQuestion: ${question}` }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const json: any = await res.json();
    const tokens = (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0);
    await (strapi.plugin('analysis').service('budget') as any).add(tokens);
    return { answer: json.content?.[0]?.text ?? '', data: context };
  },
});
