'use client'

import { useState } from 'react'
import { Link as LinkIcon, X } from 'lucide-react'
import { hostname } from './kind-meta'

/** Attach-a-link input + removable chips — shared by the composer and the
 *  card edit mode (previously two parallel copies of the same state). */
export function LinkListEditor({
  links,
  onChange,
}: {
  links: string[]
  onChange: (links: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const raw = draft.trim()
    if (!raw) return
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    onChange([...new Set([...links, url])])
    setDraft('')
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
        placeholder="Attach a link…"
        className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button onClick={add} className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
        + Add link
      </button>
      {links.map((url) => (
        <span key={url} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
          <LinkIcon size={10} /> {hostname(url)}
          <button onClick={() => onChange(links.filter((u) => u !== url))} aria-label={`Remove ${url}`}>
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  )
}
