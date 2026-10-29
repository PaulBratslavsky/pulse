/**
 * What a remote server's failure may say to the person in Settings.
 *
 * Errors from the MCP SDK quote the remote response body ("Error POSTing to
 * endpoint: <body>"). For a URL a team member typed in, echoing that turns a
 * blind request into a read of whatever answered — so only a category goes
 * back, and the full message goes to the server log. Errors Pulse raises itself
 * carry `expose: true` and are shown as written.
 *
 * Kept free of Strapi imports so the unit tests can load it directly.
 */
export function publicError(err: any): string {
  // fetch wraps a refused lookup as "fetch failed" with the reason as `cause`
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.expose) return String(e.message)
  }
  const msg = String(err?.message ?? err ?? '')
  const code = String(err?.code ?? err?.cause?.code ?? '')
  if (/\b401\b|unauthori[sz]ed|invalid.?token/i.test(msg)) return 'the server rejected the credentials'
  if (/\b403\b|forbidden/i.test(msg)) return 'the server refused access'
  if (/timeout|timed out|aborted/i.test(msg) || code === 'UND_ERR_CONNECT_TIMEOUT') return 'the server did not answer in time'
  if (/ENOTFOUND|EAI_AGAIN/.test(msg + code)) return 'could not find that host'
  if (/ECONNREFUSED|ECONNRESET|fetch failed|socket/i.test(msg + code)) return 'could not reach the server'
  if (/redirect/i.test(msg)) return 'the server redirected somewhere it should not'
  return 'the server returned an error (details are in the Pulse server log)'
}

/** An error whose message is Pulse's own and safe to show. */
export const exposed = (message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { expose: true }, extra)
