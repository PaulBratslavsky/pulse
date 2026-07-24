'use strict'

/**
 * analysis plugin — sentiment, topics, drafts behind a provider-agnostic AI interface.
 * - v1 provider: Anthropic (AI_PROVIDER=anthropic), called via fetch (no SDK lock-in).
 * - No AI_API_KEY → deterministic heuristic fallback (local dev / demo works keyless);
 *   modelVersion records exactly what produced each analysis (trend integrity).
 * - humanCorrected mentions: corrected fields are NEVER overwritten (spec rule).
 * - Daily token budget: warn ops at 80%, halt re-cluster at 100% — new-mention
 *   analysis always continues.
 * - Draft grounding: best-effort lookup against the Strapi docs MCP
 *   (STRAPI_DOCS_MCP_URL, stateless JSON-RPC POST); graceful fallback to
 *   instructing the model to cite docs.strapi.io.
 */

const PROMPT_VERSION = 'v1'

const utcDay = () => new Date().toISOString().slice(0, 10)

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

      function heuristicAnalysis(content) {
        const text = String(content).toLowerCase()
        const neg = ['broken', 'bug', 'crash', 'terrible', 'hate', 'worst', 'confusing', 'fails', 'error', 'stuck']
        const pos = ['love', 'great', 'awesome', 'amazing', 'thanks', 'works', 'best', 'easy', 'perfect']
        let score = 0
        for (const w of neg) if (text.includes(w)) score -= 0.3
        for (const w of pos) if (text.includes(w)) score += 0.3
        score = Math.max(-1, Math.min(1, score))
        const label = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral'
        const topics = []
        if (/(doc|guide|tutorial)/.test(text)) topics.push('Docs')
        if (/(bug|crash|error|broken)/.test(text)) topics.push('Bugs')
        if (/(deploy|cloud|host)/.test(text)) topics.push('Deployment')
        if (/(auth|login|permission)/.test(text)) topics.push('Auth')
        if (!topics.length) topics.push('General')
        return { score, label, topics }
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
        /** → { score, label, topics[], modelVersion, promptVersion } */
        async analyze(mention) {
          const raw = await callAnthropic(
            'You analyze social mentions about the Strapi CMS. Reply with STRICT JSON only: ' +
              '{"score": <-1..1>, "label": "positive"|"neutral"|"negative", "topics": [<1-3 short topic names, e.g. "Docs", "Migrations", "Better Auth plugin">]}',
            `Mention: "${mention.content}"`,
            300
          ).catch((err) => {
            strapi.log.warn(`[analysis] provider error, falling back to heuristic: ${err.message}`)
            return null
          })

          if (raw) {
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
              strapi.log.warn('[analysis] unparseable provider output, using heuristic')
            }
          }
          const h = heuristicAnalysis(mention.content)
          return { ...h, topics: h.topics, modelVersion: 'heuristic-v1', promptVersion: PROMPT_VERSION }
        },

        /** Docs-grounded draft answer. Never persisted here — the human decides. */
        async draft(mention) {
          const docs = await docsLookup(String(mention.content).slice(0, 300))
          const grounded = docs
            ? `Relevant official docs context (from the Strapi docs MCP):\n${docs}\n\n`
            : 'No docs-MCP context available — cite specific https://docs.strapi.io pages you are confident exist.\n\n'
          const raw = await callAnthropic(
            'You draft public replies on behalf of the Strapi DevRel team. Warm, concise, technically precise. ' +
              'Ground every claim in official Strapi documentation and include doc links. ' +
              'A human will review and post this manually — never claim it was posted.',
            `${grounded}Mention from @${mention.authorHandle ?? 'user'}: "${mention.content}"\n\nDraft a reply:`,
            600
          ).catch((err) => {
            strapi.log.warn(`[analysis] draft provider error: ${err.message}`)
            return null
          })
          return (
            raw ??
            `(keyless dev fallback) Thanks for flagging this! The team is looking at it — in the meantime, ` +
              `https://docs.strapi.io is the best reference. We'll follow up here.`
          )
        },
      }
    },

    sweep: ({ strapi }) => ({
      /** Every-minute cron: analyze pending/failed mentions; Slack-notify newly analyzed. */
      async run() {
        const pending = await strapi.documents('api::mention.mention').findMany({
          filters: { analysisStatus: { $in: ['pending', 'failed'] } },
          populate: { topics: true },
          pagination: { limit: 20 },
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

      /** Nightly: assign topics to analyzed-but-topicless mentions (never touches humanCorrected). Skipped when budget exhausted. */
      async recluster() {
        const { exceeded } = await strapi.plugin('analysis').service('budget').status()
        if (exceeded) {
          strapi.log.warn('[analysis] recluster skipped — daily AI budget exhausted')
          return 0
        }
        const orphans = await strapi.documents('api::mention.mention').findMany({
          filters: { analysisStatus: 'analyzed', humanCorrected: false, topics: { documentId: { $null: true } } },
          pagination: { limit: 50 },
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
