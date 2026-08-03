import { factories } from '@strapi/strapi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

/**
 * External MCP servers, registered from Settings.
 *
 * Connections are made HERE, in Strapi, not in the browser: AI_API_KEY, the
 * daily token budget and the tool-calling loop already live server-side, and it
 * means the reply drafter gets these tools too rather than only chat. It also
 * keeps OAuth tokens in the database as private fields instead of localStorage.
 *
 * Pulse's own 12 tools are NOT registered this way — they stay in-process
 * (src/tools/registry.ts). Making the app call its own HTTP MCP endpoint would
 * add a network hop, a second auth token, and a self-deadlock risk for nothing.
 */

/**
 * Read a row INCLUDING its private fields.
 *
 * `strapi.documents().findOne()` sanitizes the result, and clientId /
 * clientSecret / accessToken are all `private` — so reading the row that way
 * hands the OAuth provider an undefined client_id and the token exchange fails
 * with "Missing client_id". The query engine returns raw columns.
 */
const loadRow = (strapi: any, documentId: string) =>
  strapi.db.query('api::mcp-server.mcp-server').findOne({ where: { documentId } })

/**
 * OAuth state that persists to the row rather than to memory.
 *
 * The MCP SDK drives the whole flow — dynamic client registration, PKCE, the
 * code exchange, and refresh — and calls back into this object to load and save
 * state. Servers like https://strapi-docs.mcp.kapa.ai advertise only
 * `authorization_code` and `refresh_token` (no client_credentials), so a human
 * has to approve access once in a browser; everything after that is automatic.
 */
class DbOAuthProvider implements OAuthClientProvider {
  authUrl?: string
  private _verifier?: string

  constructor(
    private readonly strapi: any,
    private readonly documentId: string,
    public readonly redirectUrl: string,
    private row: any
  ) {}

  get clientMetadata() {
    return {
      client_name: 'Strapi Pulse',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code' as const, 'refresh_token' as const],
      response_types: ['code' as const],
      token_endpoint_auth_method: 'client_secret_post' as const,
    }
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (!this.row?.clientId) return undefined
    return {
      client_id: this.row.clientId,
      ...(this.row.clientSecret ? { client_secret: this.row.clientSecret } : {}),
      // Say which method, or the SDK picks for us — and it prefers
      // client_secret_basic whenever a secret exists and the server lists basic
      // at all, whatever order the server listed them in. Basic puts the
      // credentials in the Authorization header; kapa.ai reads client_id from
      // the request BODY only, so the exchange came back "Missing client_id".
      // This is the method we registered with above, and the SDK ignores it if
      // a server does not support it.
      token_endpoint_auth_method: this.clientMetadata.token_endpoint_auth_method,
    } as OAuthClientInformationMixed
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    await this.patch({
      clientId: (info as any).client_id,
      clientSecret: (info as any).client_secret ?? null,
    })
  }

  tokens(): OAuthTokens | undefined {
    if (!this.row?.accessToken) return undefined
    return {
      access_token: this.row.accessToken,
      token_type: 'Bearer',
      ...(this.row.refreshToken ? { refresh_token: this.row.refreshToken } : {}),
    } as OAuthTokens
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.patch({
      accessToken: tokens.access_token,
      // a refresh that returns no new refresh_token must not erase the old one
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
        : null,
    })
  }

  saveCodeVerifier(v: string) {
    this._verifier = v
  }

  codeVerifier() {
    if (!this._verifier) throw new Error('no PKCE verifier for this session')
    return this._verifier
  }

  /** The SDK hands us the URL instead of redirecting — the browser opens it. */
  redirectToAuthorization(url: URL) {
    this.authUrl = url.toString()
  }

  private async patch(data: Record<string, unknown>) {
    await this.strapi
      .documents('api::mcp-server.mcp-server')
      .update({ documentId: this.documentId, data: data as any })
    // re-read raw: update() returns the SANITIZED document, so keeping it would
    // silently drop the client credentials we just saved
    this.row = await loadRow(this.strapi, this.documentId)
  }
}

/**
 * OAuth is a two-request dance (start → user consents → finish) and the PKCE
 * verifier must survive between them. It is deliberately memory-only and
 * short-lived: it is a secret that is useless after the exchange, and writing it
 * to the database would persist it far longer than its ten-minute purpose.
 */
const pending = new Map<string, { provider: DbOAuthProvider; transport: any; at: number }>()
const PENDING_TTL_MS = 10 * 60 * 1000
const sweepPending = () => {
  const now = Date.now()
  for (const [k, v] of pending) if (now - v.at > PENDING_TTL_MS) pending.delete(k)
}

export default factories.createCoreService('api::mcp-server.mcp-server', ({ strapi }) => ({
  /**
   * Try to connect. Returns either the discovered tools, or an authorization
   * URL for the browser to open.
   */
  async connect(documentId: string, callbackUrl: string) {
    const row: any = await loadRow(strapi, documentId)
    if (!row) throw Object.assign(new Error('server not found'), { status: 404 })

    sweepPending()
    const provider = new DbOAuthProvider(strapi, documentId, callbackUrl, row)
    const transport = new StreamableHTTPClientTransport(new URL(row.url), {
      authProvider: provider as any,
    })
    const client = new Client({ name: 'strapi-pulse', version: '1.0.0' }, { capabilities: {} })

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      const names = tools.map((t: any) => t.name)
      await client.close()
      await strapi.documents('api::mcp-server.mcp-server').update({
        documentId,
        data: {
          status: 'connected',
          statusDetail: null,
          tools: names,
          lastConnectedAt: new Date().toISOString(),
        } as any,
      })
      return { status: 'connected' as const, tools: names }
    } catch (err: any) {
      if (err instanceof UnauthorizedError && provider.authUrl) {
        pending.set(documentId, { provider, transport, at: Date.now() })
        await strapi.documents('api::mcp-server.mcp-server').update({
          documentId,
          data: { status: 'needs-auth', statusDetail: 'waiting for authorization' } as any,
        })
        return { status: 'auth_required' as const, authUrl: provider.authUrl }
      }
      await strapi.documents('api::mcp-server.mcp-server').update({
        documentId,
        data: { status: 'error', statusDetail: String(err.message).slice(0, 500) } as any,
      })
      throw err
    }
  },

  /** Finish the flow with the code the callback page sent back. */
  async finishAuth(documentId: string, code: string) {
    const session = pending.get(documentId)
    if (!session) {
      throw Object.assign(new Error('no pending authorization — start again'), { status: 409 })
    }
    try {
      await session.transport.finishAuth(code)
      pending.delete(documentId)
      // reconnect with the tokens the exchange just persisted
      return await (this as any).connect(documentId, session.provider.redirectUrl)
    } catch (err: any) {
      pending.delete(documentId)
      // The row only keeps the message, and a provider's message can be as
      // unhelpful as "Missing client_id" — log the stack while we still have it.
      strapi.log.error(`[mcp] token exchange failed for ${documentId}: ${err.stack ?? err.message}`)
      await strapi.documents('api::mcp-server.mcp-server').update({
        documentId,
        data: { status: 'error', statusDetail: String(err.message).slice(0, 500) } as any,
      })
      throw err
    }
  },

  /**
   * Ask the server a real question and show what came back.
   *
   * "connected" only proves the handshake and tools/list worked. It says nothing
   * about whether the token is still good, whether the tool answers, or whether
   * the answer is any use — and those are what the drafter depends on. This is
   * the one button that exercises the whole path a draft actually takes.
   *
   * Never writes status: a failing test is information, not a state change, and
   * silently flipping a working server to 'error' because one query timed out
   * would be worse than the thing it reports.
   */
  async test(documentId: string, query: string) {
    const row: any = await loadRow(strapi, documentId)
    if (!row) throw Object.assign(new Error('server not found'), { status: 404 })

    // redirectUrl is only read when the provider has to REGISTER a client, and
    // that cannot happen here: no client means no token, which we reject below.
    const provider = new DbOAuthProvider(strapi, documentId, '', row)
    const transport = new StreamableHTTPClientTransport(new URL(row.url), {
      authProvider: provider as any,
    })
    const client = new Client({ name: 'strapi-pulse', version: '1.0.0' }, { capabilities: {} })
    const startedAt = Date.now()

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      if (!tools.length) throw new Error('the server exposes no tools')

      const tool = pickTool(tools)
      const args = argsFor(tool, query)
      if (!args) {
        throw new Error(
          `cannot auto-fill ${tool.name} — it needs ${(tool.inputSchema?.required ?? []).join(', ')}`
        )
      }

      const result: any = await client.callTool({ name: tool.name, arguments: args }, undefined, {
        timeout: 30_000,
      })

      const text = (result.content ?? [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n')
        .trim()
      const body = text || JSON.stringify(result.structuredContent ?? {})
      const rows = result.structuredContent?.results

      return {
        tool: tool.name,
        query,
        ms: Date.now() - startedAt,
        isError: Boolean(result.isError),
        resultCount: Array.isArray(rows) ? rows.length : null,
        // a preview for a human, not a payload for a model — the drafter gets
        // the whole thing, this panel only has to prove it arrived
        preview: body.slice(0, 1200),
        truncated: body.length > 1200,
      }
    } catch (err: any) {
      if (err instanceof UnauthorizedError) {
        throw Object.assign(new Error('not authorized — click Connect first'), { status: 401 })
      }
      strapi.log.warn(`[mcp] test call to ${row.name} failed: ${err.stack ?? err.message}`)
      throw err
    } finally {
      await client.close().catch(() => {})
    }
  },
}))

/**
 * Which tool to call when the human just wants to know the server is alive.
 *
 * A search tool is both the likeliest to exist and the safest to fire blind —
 * it reads. Falling back to tools[0] is a deliberate compromise: on an unknown
 * server that could be a tool that writes, so the button is labelled as running
 * a query and the tool name is always reported back with the result.
 */
const pickTool = (tools: any[]) =>
  tools.find((t) => /search|query|ask|find|docs|retriev|lookup/i.test(t.name)) ?? tools[0]

/** Names a server is likely to give the parameter that takes a question. */
const QUESTION_PARAM = /^(query|question|q|search|prompt|text|input|term)$/i

/**
 * Fill the tool's required arguments from one plain-language question, or
 * return null rather than guess. Two required strings have no honest answer —
 * the question belongs in one of them and we cannot tell which.
 */
function argsFor(tool: any, query: string): Record<string, unknown> | null {
  const props = tool.inputSchema?.properties ?? {}
  const required: string[] = tool.inputSchema?.required ?? []
  const strings = required.filter((k) => (props[k]?.type ?? 'string') === 'string')
  const target = strings.find((k) => QUESTION_PARAM.test(k)) ?? (strings.length === 1 ? strings[0] : null)
  if (strings.length && !target) return null

  const args: Record<string, unknown> = {}
  for (const key of required) {
    const type = props[key]?.type
    if (key === target) args[key] = query
    else if (type === 'number' || type === 'integer') args[key] = 1
    else if (type === 'boolean') args[key] = false
    else if (type === 'array') args[key] = []
    else if (type === 'string') return null // a second free-text field we cannot guess
    else return null
  }
  return args
}
