/**
 * OAuth landing page for MCP server authorization.
 *
 * The provider redirects the popup here with ?code=…; we hand the code back to
 * the window that opened it and close. The code is exchanged SERVER-side (the
 * PKCE verifier and the resulting tokens never touch the browser) — this page
 * is only a courier.
 */
export default async function OAuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string; error?: string; error_description?: string }>
}) {
  const { code, state, error, error_description } = await searchParams

  if (error) {
    return (
      <div className="p-10 text-center">
        <p className="text-lg font-medium">Authorization failed</p>
        <p className="mt-2 text-sm text-zinc-500">{error_description || error}</p>
        <p className="mt-4 text-sm text-zinc-500">You can close this window.</p>
      </div>
    )
  }

  if (!code) {
    return (
      <div className="p-10 text-center">
        <p className="text-lg font-medium">Missing authorization code</p>
        <p className="mt-2 text-sm text-zinc-500">You can close this window.</p>
      </div>
    )
  }

  // RFC 6749 says a code is printable ASCII (VSCHAR). Anything else — and in
  // particular anything with "<" — did not come from a provider.
  const looksValid = (v: string) => /^[\x21-\x7e]{1,2048}$/.test(v) && !v.includes('<')
  if (!looksValid(code) || (state != null && state !== '' && !looksValid(state))) {
    return (
      <div className="p-10 text-center">
        <p className="text-lg font-medium">Authorization failed</p>
        <p className="mt-2 text-sm text-zinc-500">The provider sent back a malformed code.</p>
        <p className="mt-4 text-sm text-zinc-500">You can close this window.</p>
      </div>
    )
  }

  // The values come from the query string, so they must never become script
  // TEXT: JSON.stringify leaves "</script>" alone, which closes the tag and lets
  // the rest run as HTML. They go in an inert JSON block instead, with "<"
  // escaped, and a fixed script reads them back.
  const payload = JSON.stringify({ type: 'mcp-oauth-callback', code, state: state ?? '' }).replace(/</g, '\\u003c')

  return (
    <div className="p-10 text-center">
      <p className="text-lg font-medium">Authorized</p>
      <p className="mt-2 text-sm text-zinc-500">This window will close automatically.</p>
      <script id="oauth-payload" type="application/json" dangerouslySetInnerHTML={{ __html: payload }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var msg = JSON.parse(document.getElementById('oauth-payload').textContent);
              // targetOrigin is our own origin — the opener is Pulse, and a
              // wildcard would broadcast the code to any listener
              if (window.opener) window.opener.postMessage(msg, window.location.origin);
              setTimeout(function () { window.close(); }, 1200);
            })();
          `,
        }}
      />
    </div>
  )
}
