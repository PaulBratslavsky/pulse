'use strict'

/**
 * pulse-mcp-tools — custom tools on Strapi's OFFICIAL built-in MCP server
 * (strapi.ai.mcp, GA since 5.49). Registered in register(), before mcp.start().
 *
 * Auth model (verified against @strapi/core 5.51 + @strapi/types mcp.d.ts):
 * each tool declares CASL auth policies; the session gate passes when the
 * presenting Admin API token's ability satisfies ANY policy. All three tools
 * are read-only — a read-only Admin API token is sufficient (least privilege
 * for reporting clients, per the build spec). Policies list both the
 * content-api and content-manager action conventions so either token
 * permission mapping satisfies the gate.
 */

const { z } = require('@strapi/utils')

const readPolicy = (uid) => ({
  policies: [
    { action: `${uid}.find` },
    { action: 'plugin::content-manager.explorer.read', subject: uid },
  ],
})

const asResult = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: { result: data },
})

const outputSchema = z.object({ result: z.any() })

module.exports = () => ({
  register({ strapi }) {
    const mcp = strapi.ai?.mcp
    if (!mcp?.registerTool) {
      strapi.log.warn(
        '[pulse-mcp-tools] strapi.ai.mcp unavailable — is mcp.enabled set in config/server and Strapi ≥ 5.49?'
      )
      return
    }
    const insights = () => strapi.plugin('analysis').service('insights')

    try {
      mcp.registerTool({
        name: 'pulse-search-mentions',
        title: 'Pulse: search mentions',
        description:
          'Search Pulse mentions by text. Returns matching mentions with sentiment, status, and topics.',
        auth: readPolicy('api::mention.mention'),
        resolveInputSchema: () =>
          z.object({
            query: z.string().min(2).describe('Text to search mention content for'),
            limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
          }),
        resolveOutputSchema: () => outputSchema,
        createHandler: (strapi) => async ({ args }) => {
          const mentions = await strapi.documents('api::mention.mention').findMany({
            filters: { content: { $containsi: args.query } },
            fields: ['content', 'sentimentLabel', 'sentimentScore', 'status', 'postedAt', 'url'],
            populate: { topics: { fields: ['name'] }, channel: { fields: ['name'] } },
            sort: 'postedAt:desc',
            pagination: { limit: args.limit ?? 20 },
          })
          return asResult(mentions)
        },
      })

      mcp.registerTool({
        name: 'pulse-trend-summary',
        title: 'Pulse: sentiment trend',
        description:
          'The Pulse sentiment score (0-100, trailing-7d volume-weighted, UTC days) over a date range, with annotated events.',
        auth: readPolicy('api::mention.mention'),
        resolveInputSchema: () =>
          z.object({
            from: z.string().optional().describe('ISO date, default 90 days ago'),
            to: z.string().optional().describe('ISO date, default now'),
            topic: z.string().optional().describe('Topic slug to filter by'),
          }),
        resolveOutputSchema: () => outputSchema,
        createHandler: () => async ({ args }) => asResult(await insights().trends(args)),
      })

      mcp.registerTool({
        name: 'pulse-theme-report',
        title: 'Pulse: recurring themes',
        description:
          'Recurring themes ranked by volume × negativity over a window (days), with evidence mention ids.',
        auth: readPolicy('api::topic.topic'),
        resolveInputSchema: () =>
          z.object({
            days: z.number().int().min(1).max(365).optional().describe('Window in days (default 30)'),
          }),
        resolveOutputSchema: () => outputSchema,
        createHandler: () => async ({ args }) => asResult(await insights().themes(args)),
      })

      strapi.log.info('[pulse-mcp-tools] registered 3 MCP tools on the built-in server')
    } catch (err) {
      strapi.log.error(`[pulse-mcp-tools] tool registration failed: ${err.message}`)
    }
  },
})
