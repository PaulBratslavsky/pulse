'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Link as LinkIcon, Pencil, Trash2 } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { Avatar } from '@/components/ui'
import { KIND_META, hostname } from './kind-meta'
import { LinkListEditor } from './link-list-editor'
import type { DiscussionEntryData } from './types'

/** One note/comment/feedback card. Owns its OWN edit/delete state — the old
 *  single-component version threaded parallel edit state through the parent. */
export function DiscussionCard({ entry, mine }: { entry: DiscussionEntryData; mine: boolean }) {
  const router = useRouter()
  const meta = KIND_META[entry.kind] ?? KIND_META.comment
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(entry.body)
  const [editLinks, setEditLinks] = useState<string[]>(entry.links)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const saveEdit = useMutation({
    mutationFn: () => pulseFetch('PUT', `comments/${entry.id}`, { data: { body: editBody, links: editLinks } }),
    onSuccess: () => {
      setEditing(false)
      router.refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => pulseFetch('DELETE', `comments/${entry.id}`),
    onSuccess: () => {
      setConfirmDelete(false)
      router.refresh()
    },
  })
  const startEdit = () => {
    setEditing(true)
    setEditBody(entry.body)
    setEditLinks(entry.links)
    setConfirmDelete(false)
  }

  return (
    <li className={`rounded-lg border p-3 ${meta.card}`}>
      <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
        <Avatar name={entry.author} />
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{entry.author ?? '—'}</span>
        {meta.badge && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.badgeClass}`}>
            {meta.badge}
          </span>
        )}
        <span>{entry.at ? new Date(entry.at).toLocaleString() : ''}</span>
        {entry.edited && <span className="italic">(edited)</span>}
        {mine && !editing && (
          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={startEdit}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="Edit"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            {confirmDelete ? (
              <>
                <button
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                >
                  {remove.isPending ? '…' : 'Delete?'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-zinc-500">
                  cancel
                </button>
                {remove.isError && <span className="text-[10px] text-red-600">{String(remove.error)}</span>}
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
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
      {editing ? (
        <div>
          <textarea
            value={editBody}
            onChange={(ev) => setEditBody(ev.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <LinkListEditor links={editLinks} onChange={setEditLinks} />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => saveEdit.mutate()}
              disabled={saveEdit.isPending || !editBody.trim()}
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
            >
              {saveEdit.isPending ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-zinc-500">
              Cancel
            </button>
            {saveEdit.isError && <p className="text-xs text-red-600">{String(saveEdit.error)}</p>}
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-sm">{entry.body}</p>
          {entry.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.links.map((url) => (
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
}
