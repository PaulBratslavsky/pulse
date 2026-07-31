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

  // JSON.stringify, not interpolation: the code goes inside a script tag and a
  // provider is free to put quotes in it.
  const payload = JSON.stringify({ type: 'mcp-oauth-callback', code, state: state ?? '' })

  return (
    <div className="p-10 text-center">
      <p className="text-lg font-medium">Authorized</p>
      <p className="mt-2 text-sm text-zinc-500">This window will close automatically.</p>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var msg = ${payload};
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
