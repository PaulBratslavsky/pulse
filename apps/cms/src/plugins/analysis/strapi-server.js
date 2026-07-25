'use strict'

/**
 * analysis plugin — sentiment, topics, drafts behind a provider-agnostic AI interface.
 * - v1 provider: Anthropic (AI_PROVIDER=anthropic), called via fetch (no SDK lock-in).
 * - **AI is optional.** No AI_API_KEY → AI features are DISABLED, not degraded:
 *   no fake heuristics, mentions get analysisStatus 'skipped' (sentiment stays
 *   null, labeling is manual via the correction flow), drafts/chat return 503.
 *   Adding a key later auto-analyzes previously skipped mentions (sweep picks
 *   up 'skipped' when enabled). modelVersion records what produced each
 *   analysis (trend integrity).
 * - humanCorrected mentions: corrected fields are NEVER overwritten (spec rule).
 * - Daily token budget: warn ops at 80%, halt re-cluster at 100% — new-mention
 *   analysis always continues.
 * - Draft grounding: best-effort lookup against the Strapi docs MCP
 *   (STRAPI_DOCS_MCP_URL, stateless JSON-RPC POST); graceful fallback to
 *   instructing the model to cite docs.strapi.io.
 */

const PROMPT_VERSION = 'v1'

const utcDay = () => new Date().toISOString().slice(0, 10)

const aiEnabled = () => Boolean(process.env.AI_API_KEY)

const insightsService = require('./insights-service')

module.exports = () => ({
  services: {
    insights: insightsService,

    budget: ({ strapi }) => {
      const store = () => strapi.store({ type: 'plugin', name: 'analysis' })
      const limit = () => Number(process.env.AI_DAILY_TOKEN_BUDGET || 0)
      return {
        async add(tokens) {
          if (!tokens) return
          const key = `usage:${utcDay()}`
          const current = Number((await store().get({ key })) || 0)
          await store().set({ key, value: current + tokens })
          const budget = limit()
          if (budget > 0) {
            const spent = current + tokens
            const warnedKey = `warned:${utcDay()}`
            if (spent >= budget * 0.8 && !(await store().get({ key: warnedKey }))) {
              await store().set({ key: warnedKey, value: true })
              await strapi
                .plugin('notify')
                .service('slack')
                .ops(`AI budget at ${Math.round((spent / budget) * 100)}% (${spent}/${budget} tokens today)`)
                .catch(() => {})
            }
          }
        },
        async status() {
          const spent = Number((await store().get({ key: `usage:${utcDay()}` })) || 0)
          const budget = limit()
          return { spent, budget, exceeded: budget > 0 && spent >= budget }
        },
        async reset() {
          await store().set({ key: `usage:${utcDay()}`, value: 0 })
          await store().set({ key: `warned:${utcDay()}`, value: false })
        },
      }
    },

    ai: ({ strapi }) => {
      const model = () => process.env.AI_MODEL || 'claude-sonnet-5'

      async function callAnthropic(system, user, maxTokens) {
        if (!process.env.AI_API_KEY) return null
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.AI_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: model(),
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        })
        if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
        const json = await res.json()
        const tokens = (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0)
        await strapi.plugin('analysis').service('budget').add(tokens)
        return json.content?.[0]?.text ?? ''
      }

      async function docsLookup(question) {
        const url = process.env.STRAPI_DOCS_MCP_URL
        if (!url) return null
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'search', arguments: { query: question } },
            }),
          })
          if (!res.ok) return null
          const json = await res.json()
          return JSON.stringify(json.result ?? null)?.slice(0, 4000) ?? null
        } catch {
          return null
        }
      }

      return {
        /** AI features on/off — single source of truth for backend + frontend config. */
        enabled: () => aiEnabled(),

        /** → { score, label, topics[], modelVersion, promptVersion } | null when AI disabled */
        async analyze(mention) {
          if (!aiEnabled()) return null
          const raw = await callAnthropic(
            'You analyze social mentions about the Strapi CMS. Reply with STRICT JSON only: ' +
              '{"score": <-1..1>, "label": "positive"|"neutral"|"negative", "topics": [<1-3 short topic names, e.g. "Docs", "Migrations", "Better Auth plugin">]}',
            `Mention: "${mention.content}"`,
            300
          )
          try {
            const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ''))
            return {
              score: Math.max(-1, Math.min(1, Number(parsed.score) || 0)),
              label: ['positive', 'neutral', 'negative'].includes(parsed.label) ? parsed.label : 'neutral',
              topics: Array.isArray(parsed.topics) && parsed.topics.length ? parsed.topics.slice(0, 3) : ['General'],
              modelVersion: model(),
              promptVersion: PROMPT_VERSION,
            }
          } catch {
            throw new Error('unparseable provider output')
          }
        },

        /** Docs-grounded draft answer, or null when AI disabled. Never persisted — the human decides. */
        async draft(mention) {
          if (!aiEnabled()) return null
          const docs = await docsLookup(String(mention.content).slice(0, 300))
          const grounded = docs
            ? `Relevant official docs context (from the Strapi docs MCP):\n${docs}\n\n`
            : 'No docs-MCP context available — cite specific https://docs.strapi.io pages you are confident exist.\n\n'
          return callAnthropic(
            'You draft public replies on behalf of the Strapi DevRel team. Warm, concise, technically precise. ' +
              'Ground every claim in official Strapi documentation and include doc links. ' +
              'A human will review and post this manually — never claim it was posted.',
            `${grounded}Mention from @${mention.authorHandle ?? 'user'}: "${mention.content}"\n\nDraft a reply:`,
            600
          )
        },
      }
    },

    sweep: ({ strapi }) => ({
      /** Every-minute cron. AI enabled: analyze pending/failed (+ previously
       *  skipped — auto-catch-up after a key is added). AI disabled: mark
       *  pending as 'skipped' and STILL Slack-notify — ingest → queue →
       *  respond works fully without AI; labeling is manual. */
      async run() {
        if (!aiEnabled()) {
          const pending = await strapi.documents('api::mention.mention').findMany({
            filters: { analysisStatus: 'pending' },
            limit: 50,
            sort: 'receivedAt:asc',
          })
          for (const mention of pending) {
            const updated = await strapi.documents('api::mention.mention').update({
              documentId: mention.documentId,
              data: { analysisStatus: 'skipped' },
            })
            await strapi.plugin('notify').service('slack').newMention(updated).catch(() => {})
          }
          return pending.length
        }

        const pending = await strapi.documents('api::mention.mention').findMany({
          filters: { analysisStatus: { $in: ['pending', 'failed', 'skipped'] } },
          populate: { topics: true },
          limit: 20,
          sort: 'receivedAt:asc',
        })
        for (const mention of pending) {
          try {
            const result = await strapi.plugin('analysis').service('ai').analyze(mention)

            // ensure topics exist (slug auto-generated by the Document Service middleware)
            const topicIds = []
            for (const name of result.topics) {
              let topic = await strapi.documents('api::topic.topic').findFirst({ filters: { name } })
              if (!topic) topic = await strapi.documents('api::topic.topic').create({ data: { name } })
              topicIds.push(topic.documentId)
            }

            // humanCorrected fields are never overwritten (spec rule)
            const data = mention.humanCorrected
              ? { analysisStatus: 'analyzed', modelVersion: result.modelVersion, promptVersion: result.promptVersion }
              : {
                  analysisStatus: 'analyzed',
                  sentimentScore: result.score,
                  sentimentLabel: result.label,
                  topics: topicIds,
                  modelVersion: result.modelVersion,
                  promptVersion: result.promptVersion,
                }
            const updated = await strapi
              .documents('api::mention.mention')
              .update({ documentId: mention.documentId, data })

            await strapi.documents('api::activity.activity').create({
              data: {
                mention: mention.documentId,
                action: 'analyzed',
                detail: { modelVersion: result.modelVersion, label: result.label },
                at: new Date().toISOString(),
              },
            })
            if (mention.analysisStatus === 'pending') {
              await strapi.plugin('notify').service('slack').newMention(updated).catch(() => {})
            }
          } catch (err) {
            strapi.log.error(`[analysis] sweep failed for ${mention.documentId}: ${err.message}`)
            await strapi
              .documents('api::mention.mention')
              .update({ documentId: mention.documentId, data: { analysisStatus: 'failed' } })
              .catch(() => {})
            await strapi
              .plugin('notify')
              .service('slack')
              .ops(`analysis failed for mention ${mention.documentId}: ${err.message}`)
              .catch(() => {})
          }
        }
        return pending.length
      },

      /** Nightly: assign topics to analyzed-but-topicless mentions (never touches humanCorrected). No-op when AI disabled or budget exhausted. */
      async recluster() {
        if (!aiEnabled()) return 0
        const { exceeded } = await strapi.plugin('analysis').service('budget').status()
        if (exceeded) {
          strapi.log.warn('[analysis] recluster skipped — daily AI budget exhausted')
          return 0
        }
        const orphans = await strapi.documents('api::mention.mention').findMany({
          filters: { analysisStatus: 'analyzed', humanCorrected: false, topics: { documentId: { $null: true } } },
          limit: 50,
        })
        for (const mention of orphans) {
          await strapi
            .documents('api::mention.mention')
            .update({ documentId: mention.documentId, data: { analysisStatus: 'pending' } })
        }
        return orphans.length
      },
    }),
  },
})
