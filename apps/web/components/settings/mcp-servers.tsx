'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Plug, Trash2, RefreshCw, FlaskConical, KeyRound } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'
import { Spinner } from '@/components/ui'

export type AuthType = 'oauth' | 'token' | 'none'
export type Purpose = 'tools' | 'resources'

export type Server = {
  documentId: string
  name: string
  url: string
  /** how it signs in: OAuth consent, a pasted token sent as a bearer header, or nothing */
  authType: AuthType
  /** `tools`: the drafter and chat may call it. `resources`: only Pulse's blog search reads it */
  purpose: Purpose
  enabled: boolean
  status: 'new' | 'connected' | 'needs-auth' | 'error'
  statusDetail?: string | null
  tools: string[]
  lastConnectedAt?: string | null
}

type TestResult = {
  tool: string
  query: string
  ms: number
  isError: boolean
  resultCount: number | null
  preview: string
  truncated: boolean
}

const AUTH_LABEL: Record<AuthType, string> = { oauth: 'OAuth', token: 'API token', none: 'no sign-in' }
const PURPOSE_LABEL: Record<Purpose, string> = { tools: 'Drafter & chat tools', resources: 'Resources: blog search' }

/** One click to fill the form for the servers people actually add. */
const PRESETS: { label: string; name: string; url: string; authType: AuthType; purpose: Purpose }[] = [
  { label: 'Strapi docs', name: 'Strapi Docs', url: 'https://strapi-docs.mcp.kapa.ai', authType: 'oauth', purpose: 'tools' },
  {
    label: 'Marketing blog (Strapi site)',
    name: 'Marketing blog',
    url: 'https://<project>.strapiapp.com/mcp',
    authType: 'token',
    purpose: 'resources',
  },
]

const STATUS: Record<string, string> = {
  connected: 'border-emerald-400 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300',
  'needs-auth': 'border-amber-400 text-amber-800 dark:border-amber-800 dark:text-amber-300',
  error: 'border-red-400 text-red-700 dark:border-red-800 dark:text-red-300',
  new: 'border-zinc-300 text-zinc-500 dark:border-zinc-700',
}

/**
 * Register external MCP servers (Strapi docs, or anything else that speaks MCP)
 * and let chat and the reply drafter call their tools.
 *
 * Connections are made by the backend, not here: the API key, the token budget
 * and the tool-calling loop already live there, and it keeps OAuth tokens in the
 * database rather than in this browser. This panel starts the flow and shows
 * what came back.
 */
export default function McpServers({ servers }: { servers: Server[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authType, setAuthType] = useState<AuthType>('oauth')
  const [token, setToken] = useState('')
  const [purpose, setPurpose] = useState<Purpose>('tools')
  // which row's "Replace token" box is open, and what is typed in it
  const [tokenFor, setTokenFor] = useState<string | null>(null)
  const [newToken, setNewToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [tested, setTested] = useState<Record<string, TestResult>>({})

  const add = useMutation({
    mutationFn: () =>
      pulseFetch('POST', 'mcp-servers', {
        name,
        url,
        authType,
        purpose,
        ...(authType === 'token' ? { token } : {}),
      }),
    onSuccess: () => {
      setName('')
      setUrl('')
      setToken('')
      setAuthType('oauth')
      setPurpose('tools')
      router.refresh()
    },
  })

  /** Paste a new token: the server signs in with it from now on, and is reconnected. */
  const saveToken = useMutation({
    mutationFn: (id: string) => pulseFetch('PUT', `mcp-servers/${id}/token`, { token: newToken }),
    onSuccess: () => {
      setTokenFor(null)
      setNewToken('')
      router.refresh()
    },
  })

  const changePurpose = useMutation({
    mutationFn: (v: { id: string; purpose: Purpose }) =>
      pulseFetch('PUT', `mcp-servers/${v.id}/purpose`, { purpose: v.purpose }),
    onSuccess: () => router.refresh(),
  })

  const remove = useMutation({
    mutationFn: (id: string) => pulseFetch('DELETE', `mcp-servers/${id}`),
    onSuccess: () => router.refresh(),
  })

  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      pulseFetch('POST', `mcp-servers/${v.id}/toggle`, { enabled: v.enabled }),
    onSuccess: () => router.refresh(),
  })

  /**
   * A real tool call, because "connected" is a weaker claim than it looks: it
   * means the handshake and tools/list worked, not that the token is still
   * valid or that the tool answers. The drafter depends on the latter.
   */
  const test = useMutation({
    mutationFn: (id: string) => pulseFetch('POST', `mcp-servers/${id}/test`, {}),
    onSuccess: (res: any, id) => setTested((t) => ({ ...t, [id]: res.data })),
    // deliberately no router.refresh(): a test writes nothing, and re-rendering
    // the list would throw away the result the user asked to see
  })

  const connect = useMutation({
    mutationFn: async (id: string) => {
      const res: any = await pulseFetch('POST', `mcp-servers/${id}/connect`, {
        callbackUrl: `${window.location.origin}/oauth-callback`,
      })
      if (res?.data?.status !== 'auth_required') return res

      // The server needs consent. Open the provider in a popup and wait for the
      // callback page to hand the code back — the popup, not a redirect, so the
      // settings page keeps its state.
      const popup = window.open(res.data.authUrl, 'mcp-oauth', 'width=620,height=760')
      if (!popup) throw new Error('popup blocked — allow popups for this site and try again')

      const code = await new Promise<string>((resolve, reject) => {
        const onMessage = (e: MessageEvent) => {
          // only trust our own callback page
          if (e.origin !== window.location.origin) return
          if (e.data?.type !== 'mcp-oauth-callback') return
          cleanup()
          resolve(e.data.code)
        }
        const poll = setInterval(() => {
          if (popup.closed) {
            cleanup()
            reject(new Error('authorization window was closed'))
          }
        }, 700)
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('timed out waiting for authorization'))
        }, 300_000)
        const cleanup = () => {
          window.removeEventListener('message', onMessage)
          clearInterval(poll)
          clearTimeout(timer)
        }
        window.addEventListener('message', onMessage)
      })

      return pulseFetch('POST', `mcp-servers/${id}/finish-auth`, { code })
    },
    onSettled: () => {
      setBusy(null)
      router.refresh()
    },
  })

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <Plug size={16} className="text-zinc-400" />
        MCP servers
      </h2>
      <p className="mb-4 text-sm text-zinc-500">
        Servers Pulse connects to. <strong className="font-medium">Drafter &amp; chat tools</strong>{' '}
        give the AI real tools — the Strapi docs server is the useful one: it searches the docs by
        content, so replies cite pages that actually exist.{' '}
        <strong className="font-medium">Resources: blog search</strong>{' '}is the marketing site that
        Resources searches; the AI never sees it, and Pulse refuses a token that can change
        anything there. Each server signs in with OAuth, a pasted API token (Strapi&apos;s built-in
        MCP server takes an admin token), or nothing. Pulse&apos;s own tools are always available
        and are not listed here.
      </p>

      {servers.length > 0 && (
        <ul className="mb-4 space-y-2">
          {servers.map((s) => (
            <li
              key={s.documentId}
              className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS[s.status]}`}>
                  {s.status}
                </span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {AUTH_LABEL[s.authType] ?? s.authType}
                </span>
                <select
                  value={s.purpose}
                  onChange={(e) => changePurpose.mutate({ id: s.documentId, purpose: e.target.value as Purpose })}
                  aria-label={`What ${s.name} is used for`}
                  className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="tools">{PURPOSE_LABEL.tools}</option>
                  <option value="resources">{PURPOSE_LABEL.resources}</option>
                </select>
                {s.tools.length > 0 && (
                  <span className="text-xs text-zinc-500">
                    {s.tools.length} tool{s.tools.length === 1 ? '' : 's'}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => toggle.mutate({ id: s.documentId, enabled: e.target.checked })}
                    />
                    enabled
                  </label>
                  <button
                    onClick={() => {
                      setBusy(s.documentId)
                      connect.mutate(s.documentId)
                    }}
                    disabled={connect.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
                  >
                    {busy === s.documentId && connect.isPending ? (
                      <Spinner size={11} />
                    ) : (
                      <RefreshCw size={11} />
                    )}
                    {s.status === 'connected' ? 'Reconnect' : 'Connect'}
                  </button>
                  {s.authType !== 'none' && (
                    <button
                      onClick={() => {
                        setTokenFor(tokenFor === s.documentId ? null : s.documentId)
                        setNewToken('')
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700"
                      title={s.authType === 'oauth' ? 'Sign in with a pasted API token instead of OAuth' : 'Paste a new token'}
                    >
                      <KeyRound size={11} />
                      {s.authType === 'token' ? 'Replace token' : 'Use a token'}
                    </button>
                  )}
                  {s.status === 'connected' && (
                    <button
                      onClick={() => {
                        setBusy(s.documentId)
                        test.mutate(s.documentId)
                      }}
                      disabled={test.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
                    >
                      {busy === s.documentId && test.isPending ? (
                        <Spinner size={11} />
                      ) : (
                        <FlaskConical size={11} />
                      )}
                      Test
                    </button>
                  )}
                  <button
                    onClick={() => remove.mutate(s.documentId)}
                    disabled={remove.isPending}
                    aria-label={`Remove ${s.name}`}
                    className="rounded-md border border-zinc-300 p-1 text-zinc-500 hover:border-red-400 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              <p className="mt-1 break-all text-xs text-zinc-400">{s.url}</p>
              {tokenFor === s.documentId && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (newToken.trim()) saveToken.mutate(s.documentId)
                  }}
                >
                  <input
                    type="password"
                    autoComplete="off"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                    placeholder="Paste the API token (stored on the server, never shown again)"
                    aria-label={`New token for ${s.name}`}
                    className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    type="submit"
                    disabled={saveToken.isPending || !newToken.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
                  >
                    {saveToken.isPending && <Spinner size={11} />}
                    Save token
                  </button>
                </form>
              )}
              {s.statusDetail && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{s.statusDetail}</p>
              )}
              {s.tools.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500">{s.tools.join(' · ')}</p>
              )}
              {tested[s.documentId] && (
                <div className="mt-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/50">
                  <p className="text-xs text-zinc-500">
                    <code>{tested[s.documentId].tool}</code> · {tested[s.documentId].ms} ms
                    {tested[s.documentId].resultCount !== null &&
                      ` · ${tested[s.documentId].resultCount} result${
                        tested[s.documentId].resultCount === 1 ? '' : 's'
                      }`}
                    {tested[s.documentId].isError && (
                      <span className="text-red-600 dark:text-red-400">
                        {' '}
                        · the tool returned an error
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs italic text-zinc-400">
                    &ldquo;{tested[s.documentId].query}&rdquo;
                  </p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">
                    {tested[s.documentId].preview}
                    {tested[s.documentId].truncated && '…'}
                  </pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        <span>Add:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setName(p.name)
              setUrl(p.url)
              setAuthType(p.authType)
              setPurpose(p.purpose)
            }}
            className="rounded-full border border-zinc-300 px-2 py-0.5 hover:border-zinc-400 dark:border-zinc-700"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Strapi docs)"
          aria-label="Server name"
          className="w-48 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          aria-label="Server URL"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={authType}
          onChange={(e) => setAuthType(e.target.value as AuthType)}
          aria-label="How it signs in"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="oauth">OAuth (sign in with a pop-up)</option>
          <option value="token">API token (bearer)</option>
          <option value="none">No sign-in</option>
        </select>
        {authType === 'token' && (
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the API token (stored on the server only)"
            aria-label="API token"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        )}
        <select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as Purpose)}
          aria-label="What it is used for"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="tools">Use for: {PURPOSE_LABEL.tools}</option>
          <option value="resources">Use for: {PURPOSE_LABEL.resources}</option>
        </select>
        <button
          onClick={() => add.mutate()}
          disabled={add.isPending || !name.trim() || !url.trim() || (authType === 'token' && !token.trim())}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
        >
          {add.isPending && <Spinner size={12} />}
          Add server
        </button>
      </div>
      <MutationError m={add} className="mt-2 text-xs" />
      <MutationError m={connect} className="mt-2 text-xs" />
      <MutationError m={test} className="mt-2 text-xs" />
      <MutationError m={remove} className="mt-2 text-xs" />
      <MutationError m={saveToken} className="mt-2 text-xs" />
      <MutationError m={changePurpose} className="mt-2 text-xs" />
    </div>
  )
}
