import { factories } from '@strapi/strapi'
import { resolveCallbackUrl } from '../services/mcp-server'
import { checkUrl } from '../../../utils/safe-fetch'
import { publicError } from '../../../utils/public-error'

/**
 * Only http(s), and in production never a loopback/private/metadata address —
 * a registered URL is fetched by the SERVER. This is the quick answer for the
 * form; safeFetch checks the address each request really connects to, so a
 * name that resolves inward is refused there.
 */
const validateUrl = (raw: unknown): string | null => {
  let u: URL
  try {
    u = new URL(String(raw))
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (process.env.NODE_ENV === 'production') {
    try {
      checkUrl(u)
    } catch {
      return null
    }
  }
  return u.toString()
}

export default factories.createCoreController('api::mcp-server.mcp-server', ({ strapi }) => ({
  /** GET /mcp-servers — never leaks tokens (they are private attributes). */
  async list(ctx) {
    const rows = await strapi
      .documents('api::mcp-server.mcp-server')
      .findMany({ sort: 'name:asc' as any, limit: 50 })
    return {
      data: rows.map((r: any) => ({
        documentId: r.documentId,
        name: r.name,
        url: r.url,
        enabled: r.enabled,
        authType: r.authType === 'token' || r.authType === 'none' ? r.authType : 'oauth',
        purpose: r.purpose === 'resources' ? 'resources' : 'tools',
        status: r.status,
        statusDetail: r.statusDetail,
        tools: r.tools ?? [],
        lastConnectedAt: r.lastConnectedAt,
      })),
      // whether this person may add, connect, re-token, repurpose or remove
      // servers — the panel hides those controls otherwise
      meta: { canManage: ctx.state.user?.role?.type === 'pulse-admin' },
    }
  },

  /**
   * POST /mcp-servers — { name, url, authType?, token?, purpose? }
   *
   * authType: `oauth` (Connect runs the consent flow), `token` (a pasted key,
   * sent as a bearer header — Strapi's built-in MCP server takes an admin
   * token this way) or `none`. purpose: `tools` (the drafter and chat may call
   * it) or `resources` (only Pulse's blog search reads it). A token or open
   * server is connected straight away, so the panel shows whether it worked.
   */
  async register(ctx) {
    const { name, url, authType, token, purpose } = ctx.request.body ?? {}
    const clean = validateUrl(url)
    if (!clean) return ctx.badRequest('url must be a public http(s) URL')
    if (!String(name ?? '').trim()) return ctx.badRequest('name is required')
    const kind = authType === 'token' || authType === 'none' ? authType : 'oauth'
    if (kind === 'token' && !String(token ?? '').trim()) return ctx.badRequest('paste the token for a token-based server')
    if (token != null && typeof token !== 'string') return ctx.badRequest('token must be a string')
    const use = purpose === 'resources' ? 'resources' : 'tools'

    const existing = await strapi
      .documents('api::mcp-server.mcp-server')
      .findFirst({ filters: { url: clean } as any })
    if (existing) return ctx.badRequest('that server is already registered')

    const row = await strapi.documents('api::mcp-server.mcp-server').create({
      data: {
        name: String(name).trim(),
        url: clean,
        authType: kind,
        purpose: use,
        // private attribute: stored, never returned by any read
        ...(kind === 'token' ? { accessToken: String(token).trim() } : {}),
        status: 'new',
        enabled: true,
      } as any,
    })

    let status = String(row.status ?? 'new')
    if (kind !== 'oauth') {
      try {
        const result = await (strapi.service('api::mcp-server.mcp-server') as any).connect(row.documentId, '')
        status = result?.status ?? status
      } catch {
        status = 'error' // the row says why; the panel shows statusDetail
      }
    }
    return { data: { documentId: row.documentId, name: row.name, url: row.url, status } }
  },

  /** PUT /mcp-servers/:documentId/token — { token }: switch to (or replace) a pasted token. */
  async setToken(ctx) {
    const token = (ctx.request.body as any)?.token
    if (typeof token !== 'string' || !token.trim()) return ctx.badRequest('token is required')
    try {
      const data = await (strapi.service('api::mcp-server.mcp-server') as any).setToken(ctx.params.documentId, token.trim())
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      return ctx.badRequest(publicError(err))
    }
  },

  /** PUT /mcp-servers/:documentId/purpose — { purpose: 'tools' | 'resources' } */
  async setPurpose(ctx) {
    const purpose = (ctx.request.body as any)?.purpose
    if (purpose !== 'tools' && purpose !== 'resources') return ctx.badRequest("purpose must be 'tools' or 'resources'")
    try {
      const data = await (strapi.service('api::mcp-server.mcp-server') as any).setPurpose(ctx.params.documentId, purpose)
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      return ctx.badRequest(publicError(err))
    }
  },

  /** POST /mcp-servers/:documentId/connect — { callbackUrl } */
  async connect(ctx) {
    const callbackUrl = resolveCallbackUrl(ctx.request.body?.callbackUrl)
    if (!callbackUrl) {
      return ctx.badRequest("callbackUrl must be this app's /oauth-callback (check PULSE_APP_URL matches the web app's address)")
    }
    try {
      const data = await (strapi.service('api::mcp-server.mcp-server') as any).connect(
        ctx.params.documentId,
        callbackUrl
      )
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      return ctx.badRequest(publicError(err))
    }
  },

  /** POST /mcp-servers/:documentId/finish-auth — { code, state } */
  async finishAuth(ctx) {
    const code = String(ctx.request.body?.code ?? '')
    const state = String(ctx.request.body?.state ?? '')
    if (!code) return ctx.badRequest('code is required')
    try {
      const data = await (strapi.service('api::mcp-server.mcp-server') as any).finishAuth(
        ctx.params.documentId,
        code,
        state
      )
      return { data }
    } catch (err: any) {
      return ctx.badRequest(publicError(err))
    }
  },

  /** POST /mcp-servers/:documentId/test — { query? }, runs one real tool call. */
  async test(ctx) {
    // A default that reads as a question, because the docs server asks for "a
    // single, well-formed natural-language query" and other servers will differ.
    const query = String(ctx.request.body?.query ?? '').trim() || 'How do I get started?'
    try {
      const data = await (strapi.service('api::mcp-server.mcp-server') as any).test(
        ctx.params.documentId,
        query.slice(0, 300)
      )
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      if (err.status === 401) return ctx.unauthorized(err.message)
      return ctx.badRequest(publicError(err))
    }
  },

  /** POST /mcp-servers/:documentId/toggle — { enabled } */
  async toggle(ctx) {
    const enabled = Boolean(ctx.request.body?.enabled)
    const row = await strapi
      .documents('api::mcp-server.mcp-server')
      .update({ documentId: ctx.params.documentId, data: { enabled } as any })
    if (!row) return ctx.notFound('server not found')
    return { data: { documentId: row.documentId, enabled: row.enabled } }
  },

  /** DELETE /mcp-servers/:documentId — also drops the stored tokens. */
  async remove(ctx) {
    await strapi
      .documents('api::mcp-server.mcp-server')
      .delete({ documentId: ctx.params.documentId })
    return { data: { ok: true } }
  },
}))
