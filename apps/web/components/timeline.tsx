'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Link as LinkIcon, X, Pencil, Trash2, ChevronRight } from 'lucide-react'

/**
 * Unified mention timeline (GitHub-issue pattern): system events render as
 * compact muted lines, team discussion (notes + comments, one flat stream —
 * never nested) renders as message cards. Notes carry an amber accent
 * (Zendesk convention for internal content) and can attach link resources.
 * Composer sits at the bottom, chat-style, oldest first.
 */

type Entry =
  | { type: 'system'; at: string; action: string; actor: string | null; detail: any }
  | {
      type: 'discussion'
      at: string
      kind: 'note' | 'comment'
      body: string
      links: string[]
      author: string | null
      authorDocumentId: string | null
      edited: boolean
      id: string
    }

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`/api/pulse/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? 'request failed')
  return res.json().catch(() => ({}))
}

const hostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Avatar({ name }: { name: string | null }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-[#4945FF] to-[#7B79FF] text-white text-[10px] font-semibold">
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}

export default function Timeline({ mention, meDocumentId }: { mention: any; meDocumentId?: string | null }) {
  const router = useRouter()
  const [kind, setKind] = useState<'comment' | 'note'>('comment')
  const [body, setBody] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [linkDraft, setLinkDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editLinks, setEditLinks] = useState<string[]>([])
  const [editLinkDraft, setEditLinkDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const entries: Entry[] = [
    ...(mention.activities ?? []).map((a: any) => ({
      type: 'system' as const,
      at: a.at,
      action: a.action,
      actor: a.actor?.username ?? null,
      detail: a.detail,
    })),
    ...(mention.comments ?? []).map((c: any) => ({
      type: 'discussion' as const,
      at: c.createdAt,
      kind: c.kind,
      body: c.body,
      links: Array.isArray(c.links) ? c.links : [],
      author: c.author?.username ?? null,
      authorDocumentId: c.author?.documentId ?? null,
      edited: Boolean(c.editedAt), // stamped by the update controller — no timestamp inference
      id: c.documentId,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const addLink = () => {
    const raw = linkDraft.trim()
    if (!raw) return
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    setLinks((prev) => [...new Set([...prev, url])])
    setLinkDraft('')
  }

  const submit = useMutation({
    mutationFn: () =>
      call('POST', 'comments', { data: { mentionDocumentId: mention.documentId, kind, body, links } }),
    onSuccess: () => {
      setBody('')
      setLinks([])
      setKind('comment')
      router.refresh()
    },
  })
  const saveEdit = useMutation({
    mutationFn: (id: string) => call('PUT', `comments/${id}`, { data: { body: editBody, links: editLinks } }),
    onSuccess: () => {
      setEditingId(null)
      router.refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => call('DELETE', `comments/${id}`),
    onSuccess: () => {
      setConfirmDeleteId(null)
      router.refresh()
    },
  })
  const startEdit = (e: Extract<Entry, { type: 'discussion' }>) => {
    setEditingId(e.id)
    setEditBody(e.body)
    setEditLinks(e.links)
    setEditLinkDraft('')
    setConfirmDeleteId(null)
  }
  const addEditLink = () => {
    const raw = editLinkDraft.trim()
    if (!raw) return
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    setEditLinks((prev) => [...new Set([...prev, url])])
    setEditLinkDraft('')
  }

  return (
    <div>
      <h2 className="font-medium mb-3">Timeline</h2>

      <ol className="space-y-3">
        {entries.length === 0 && <li className="text-sm text-zinc-500">No activity yet.</li>}
        {entries.map((e, i) => {
          if (e.type === 'system') {
            const line = (
              <>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">{e.action}</span>
                {e.actor ? ` by ${e.actor}` : ' (system)'}
                {e.action === 'acknowledged' && e.detail?.reason && (
                  <> — {e.detail.reason}{e.detail.note ? `: ${e.detail.note}` : ''}</>
                )}
                {' · '}
                {e.at ? new Date(e.at).toLocaleString() : ''}
              </>
            )
            // "answered" expands to the recorded reply (accordion via native <details>)
            const response =
              e.action === 'answered'
                ? (mention.responses ?? []).find((r: any) => r.documentId === e.detail?.responseDocumentId)
                : null
            if (response) {
              return (
                <li key={`s-${i}`} className="pl-1 text-xs text-zinc-500">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        size={12}
                        className="shrink-0 translate-y-[1px] text-zinc-400 transition-transform group-open:rotate-90"
                      />
                      <span>
                        {line}
                        <span className="text-zinc-400"> · view reply</span>
                      </span>
                    </summary>
                    <div className="ml-5 mt-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                      <p className="whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
                        {response.finalText}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        outcome: <span className="font-medium">{response.outcome?.result ?? 'not recorded'}</span>
                        {response.notes && <> · notes: {response.notes}</>}
                      </p>
                    </div>
                  </details>
                </li>
              )
            }
            return (
              <li key={`s-${i}`} className="flex items-baseline gap-2 pl-1 text-xs text-zinc-500">
                <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <span>{line}</span>
              </li>
            )
          }
          return (
            <li
              key={e.id}
              className={`rounded-lg border p-3 ${
                e.kind === 'note'
                  ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
                  : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                <Avatar name={e.author} />
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{e.author ?? '—'}</span>
                {e.kind === 'note' && (
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                    note
                  </span>
                )}
                <span>{e.at ? new Date(e.at).toLocaleString() : ''}</span>
                {e.edited && <span className="italic">(edited)</span>}
                {meDocumentId && e.authorDocumentId === meDocumentId && editingId !== e.id && (
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => startEdit(e)}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                      aria-label="Edit"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    {confirmDeleteId === e.id ? (
                      <>
                        <button
                          onClick={() => remove.mutate(e.id)}
                          disabled={remove.isPending}
                          className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                        >
                          {remove.isPending ? '…' : 'Delete?'}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] text-zinc-500">
                          cancel
                        </button>
                        {remove.isError && <span className="text-[10px] text-red-600">{String(remove.error)}</span>}
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(e.id)}
                        className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                )}
              </div>
              {editingId === e.id ? (
                <div>
                  <textarea
                    value={editBody}
                    onChange={(ev) => setEditBody(ev.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <input
                      value={editLinkDraft}
                      onChange={(ev) => setEditLinkDraft(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') {
                          ev.preventDefault()
                          addEditLink()
                        }
                      }}
                      placeholder="Attach a link…"
                      className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button onClick={addEditLink} className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
                      + Add link
                    </button>
                    {editLinks.map((url) => (
                      <span key={url} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                        <LinkIcon size={10} /> {hostname(url)}
                        <button onClick={() => setEditLinks((prev) => prev.filter((u) => u !== url))} aria-label={`Remove ${url}`}>
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => saveEdit.mutate(e.id)}
                      disabled={saveEdit.isPending || !editBody.trim()}
                      className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
                    >
                      {saveEdit.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-zinc-500">
                      Cancel
                    </button>
                    {saveEdit.isError && <p className="text-xs text-red-600">{String(saveEdit.error)}</p>}
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm">{e.body}</p>
                  {e.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {e.links.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-blue-600 hover:underline dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          <LinkIcon size={11} /> {hostname(url)}
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ol>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex gap-1.5 text-xs">
          {(['comment', 'note'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-full border px-2.5 py-1 ${
                kind === k
                  ? k === 'note'
                    ? 'border-amber-500 bg-amber-100 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'border-zinc-900 font-medium dark:border-white'
                  : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
              }`}
            >
              {k === 'note' ? 'Note (with resources)' : 'Comment'}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={kind === 'note' ? "The team's take, context, decisions…" : 'Quick comment…'}
          rows={kind === 'note' ? 3 : 2}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLink()
              }
            }}
            placeholder="Attach a link…"
            className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button onClick={addLink} className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
            + Add link
          </button>
          {links.map((url) => (
            <span
              key={url}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
            >
              <LinkIcon size={10} /> {hostname(url)}
              <button onClick={() => setLinks((prev) => prev.filter((u) => u !== url))} aria-label={`Remove ${url}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !body.trim()}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {submit.isPending ? 'Saving…' : kind === 'note' ? 'Add note' : 'Comment'}
          </button>
          {submit.isError && <p className="text-sm text-red-600">{String(submit.error)}</p>}
        </div>
      </div>
    </div>
  )
}
