import type { Core } from '@strapi/strapi'
import { createMCPClient } from '@ai-sdk/mcp'

/**
 * Turn every enabled MCP server into AI-SDK tools.
 *
 * This is what makes grounding real rather than decorative. Before, the drafter
 * did ONE blind lookup with the mention text and pasted whatever came back into
 * the prompt. With tools, the model asks its own questions — and asks again when
 * the first answer is not enough — which is how a person would use the docs.
 *
 * Everything here is best-effort: a dead or unauthorized server must cost us a
 * slightly less informed draft, never the draft itself.
 */

export type LoadedTools = {
  tools: Record<string, any>
  /** close every client; ALWAYS call this or the sockets leak */
  close: () => Promise<void>
  servers: string[]
}

const EMPTY: LoadedTools = { tools: {}, close: async () => {}, servers: [] }

export const mcpTools = ({ strapi }: { strapi: Core.Strapi }) => ({
  async load(): Promise<LoadedTools> {
    let rows: any[]
    try {
      rows = await strapi.documents('api::mcp-server.mcp-server').findMany({
        filters: { enabled: true, status: 'connected' } as any,
        limit: 20,
      })
    } catch {
      return EMPTY
    }
    if (!rows.length) return EMPTY

    const clients: any[] = []
    const tools: Record<string, any> = {}
    const servers: string[] = []

    for (const row of rows) {
      try {
        // findMany omits private fields, so re-read the token explicitly
        const token = await tokenFor(strapi, row.documentId)
        const client = await createMCPClient({
          transport: {
            type: 'http',
            url: row.url,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        })
        const t = await client.tools()
        clients.push(client)
        servers.push(row.name)
        // Namespace on collision rather than letting one server silently
        // shadow another's tool of the same name.
        for (const [name, tool] of Object.entries(t)) {
          const key = name in tools ? `${slug(row.name)}_${name}` : name
          tools[key] = tool
        }
      } catch (err: any) {
        strapi.log.warn(`[mcp] ${row.name} unavailable, continuing without it: ${err.message}`)
      }
    }

    return {
      tools,
      servers,
      close: async () => {
        for (const c of clients) await c.close?.().catch(() => {})
      },
    }
  },
})

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** Private fields are stripped from document-service reads — go to the row. */
async function tokenFor(strapi: Core.Strapi, documentId: string): Promise<string | null> {
  const row = await strapi.db
    .query('api::mcp-server.mcp-server')
    .findOne({ where: { documentId }, select: ['accessToken'] })
  return row?.accessToken ?? null
}

export default mcpTools
