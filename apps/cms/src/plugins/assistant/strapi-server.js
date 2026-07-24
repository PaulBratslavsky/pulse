'use strict'

/**
 * assistant plugin — chat with the data. POST /api/assistant/chat
 * Gathers a compact, structured context (Pulse score trend, top themes, queue
 * counts) and asks the AI provider to answer; keyless dev fallback returns a
 * deterministic summary of the same data.
 */

module.exports = () => ({
  routes: {
    'content-api': {
      type: 'content-api',
      routes: [
        {
          method: 'POST',
          path: '/chat',
          handler: 'chat.chat',
          config: { policies: [] },
        },
      ],
    },
  },

  controllers: {
    chat: ({ strapi }) => ({
      async chat(ctx) {
        const { messages } = ctx.request.body ?? {}
        if (!Array.isArray(messages) || !messages.length) return ctx.badRequest('messages[] required')
        const question = String(messages[messages.length - 1]?.content ?? '').slice(0, 2000)
        const answer = await strapi.plugin('assistant').service('answer').answer(question)
        ctx.body = { data: answer }
      },
    }),
  },

  services: {
    answer: ({ strapi }) => ({
      async answer(question) {
        // score/themes come from the single source of truth: the analysis
        // plugin's insights service (same implementation the dashboard uses).
        const insights = strapi.plugin('analysis').service('insights')
        const [trends, themes, unanswered] = await Promise.all([
          insights.trends({}),
          insights.themes({ days: 30 }),
          strapi.documents('api::mention.mention').count({ filters: { status: 'unanswered' } }),
        ])
        const latest = [...trends.series].reverse().find((p) => p.score != null)
        const context = {
          pulseScoreToday: latest?.score ?? null,
          unansweredCount: unanswered,
          topThemes30d: themes.themes.slice(0, 5).map((t) => ({
            name: t.topic.name,
            mentions: t.mentions,
            negativeShare: t.negativeShare,
          })),
          recentEvents: trends.events.slice(-5),
        }

        if (!process.env.AI_API_KEY) {
          return {
            answer:
              `(keyless dev fallback) Pulse score: ${context.pulseScoreToday ?? 'n/a'}. ` +
              `${context.unansweredCount} unanswered mention(s). Top themes (30d): ` +
              context.topThemes30d.map((t) => `${t.name} (${t.mentions}, ${t.negativeShare}% neg)`).join(', '),
            data: context,
          }
        }

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.AI_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.AI_MODEL || 'claude-sonnet-5',
            max_tokens: 800,
            system:
              'You are Pulse, the Strapi team\'s mention-sentiment assistant. Answer questions about the ' +
              'data using ONLY the JSON context provided. Be concise; give numbers; note when the context ' +
              'cannot answer the question.',
            messages: [{ role: 'user', content: `Context: ${JSON.stringify(context)}\n\nQuestion: ${question}` }],
          }),
        })
        if (!res.ok) throw new Error(`anthropic ${res.status}`)
        const json = await res.json()
        const tokens = (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0)
        await strapi.plugin('analysis').service('budget').add(tokens)
        return { answer: json.content?.[0]?.text ?? '', data: context }
      },
    }),
  },
})
