import { factories } from '@strapi/strapi'

/** Only http(s), and never a loopback/metadata address — a registered URL is
 *  fetched by the SERVER, so an unvalidated one is an SSRF primitive. */
const validateUrl = (raw: unknown): string | null => {
  let u: URL
  try {
    u = new URL(String(raw))
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) // link-local: AWS/GCP instance metadata
  if (blocked && process.env.NODE_ENV === 'production') return null
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
        status: r.status,
        statusDetail: r.statusDetail,
        tools: r.tools ?? [],
        lastConnectedAt: r.lastConnectedAt,
      })),
    }
  },

  /** POST /mcp-servers — { name, url } */
  async register(ctx) {
    const { name, url } = ctx.request.body ?? {}
    const clean = validateUrl(url)
    if (!clean) return ctx.badRequest('url must be a public http(s) URL')
    if (!String(name ?? '').trim()) return ctx.badRequest('name is required')

    const existing = await strapi
      .documents('api::mcp-server.mcp-server')
      .findFirst({ filters: { url: clean } as any })
    if (existing) return ctx.badRequest('that server is already registered')

    const row = await strapi.documents('api::mcp-server.mcp-server').create({
      data: { name: String(name).trim(), url: clean, status: 'new', enabled: true } as any,
    })
    return { data: { documentId: row.documentId, name: row.name, url: row.url, status: row.status } }
  },

  /** POST /mcp-servers/:documentId/connect — { callbackUrl } */
  async connect(ctx) {
    const callbackUrl = String(ctx.request.body?.callbackUrl ?? '')
    if (!callbackUrl) return ctx.badRequest('callbackUrl is required')
    try {
      const data = await (strapi.service('api::mcp-server.mcp-server') as any).connect(
        ctx.params.documentId,
        callbackUrl
      )
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      return ctx.badRequest(err.message)
    }
  },

  /** POST /mcp-servers/:documentId/finish-auth — { code } */
  async finishAuth(ctx) {
    const code = String(ctx.request.body?.code ?? '')
    if (!code) return ctx.badRequest('code is required')
    try {
      const data = await (strapi.service('api::mcp-server.mcp-server') as any).finishAuth(
        ctx.params.documentId,
        code
      )
      return { data }
    } catch (err: any) {
      return ctx.badRequest(err.message)
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
      return ctx.badRequest(err.message)
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
