'use client'

import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

/**
 * Topic selector. Replaces a wall of checkboxes — the vocabulary is already
 * past 100 entries, and every one rendered at once made the panel unusable and
 * pushed the Save button off screen.
 *
 * Search and create are the SAME box on purpose: the failure mode with a
 * separate "new topic" field is someone typing "Documentation" when "Docs"
 * exists, forking the vocabulary and weakening every future co-occurrence.
 * Typing filters first; creating is only offered when nothing matches.
 */

export type TopicOption = { documentId: string; name: string }

export function TopicPicker({
  all,
  selectedIds,
  onSelectedIds,
  newNames,
  onNewNames,
}: {
  all: TopicOption[]
  selectedIds: string[]
  onSelectedIds: (next: string[]) => void
  newNames: string[]
  onNewNames: (next: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const byId = useMemo(() => new Map(all.map((t) => [t.documentId, t])), [all])
  const q = query.trim().toLowerCase()

  const matches = useMemo(() => {
    const pool = all.filter((t) => !selectedIds.includes(t.documentId))
    if (!q) return pool.slice(0, 8)
    return pool
      .filter((t) => t.name.toLowerCase().includes(q))
      // prefix hits first: typing "doc" should offer "Docs" before "API docs"
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1
        return ap - bp || a.name.localeCompare(b.name)
      })
      .slice(0, 8)
  }, [all, selectedIds, q])

  // case-insensitive, because topic.ensure() matches that way server-side —
  // offering "Create Docs" when "docs" exists would be a lie
  const exists =
    !!q &&
    (all.some((t) => t.name.toLowerCase() === q) || newNames.some((n) => n.toLowerCase() === q))
  const canCreate = !!q && !exists

  // Close the list after a pick. It is absolutely positioned, and leaving it
  // open covered the Save button underneath — focus stays in the input so you
  // can keep adding, and typing reopens it.
  const commit = () => {
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }
  const add = (t: TopicOption) => {
    onSelectedIds([...selectedIds, t.documentId])
    commit()
  }
  const create = () => {
    if (!canCreate) return
    onNewNames([...new Set([...newNames, query.trim()])])
    commit()
  }

  return (
    <div className="space-y-2">
      {(selectedIds.length > 0 || newNames.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <Chip
              key={id}
              label={byId.get(id)?.name ?? id}
              onRemove={() => onSelectedIds(selectedIds.filter((x) => x !== id))}
            />
          ))}
          {newNames.map((n) => (
            <Chip
              key={n}
              label={n}
              isNew
              onRemove={() => onNewNames(newNames.filter((x) => x !== n))}
            />
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          // blur is delayed so a click on an option lands before the list closes
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (matches.length) add(matches[0])
              else create()
            }
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search topics, or type a new one…"
          aria-label="Search or add topics"
          role="combobox"
          aria-expanded={open}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />

        {open && (matches.length > 0 || canCreate) && (
          <ul data-testid="topic-options" className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {matches.map((t) => (
              <li key={t.documentId}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(t)}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {t.name}
                </button>
              </li>
            ))}
            {canCreate && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={create}
                  className="block w-full px-3 py-1.5 text-left text-sm text-violet-700 hover:bg-zinc-100 dark:text-violet-300 dark:hover:bg-zinc-800"
                >
                  + Create “{query.trim()}”
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

function Chip({ label, isNew, onRemove }: { label: string; isNew?: boolean; onRemove: () => void }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        isNew
          ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300'
          : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
      }`}
    >
      #{label}
      {isNew && <span className="text-[10px] opacity-70">new</span>}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="hover:opacity-70">
        <X size={11} />
      </button>
    </span>
  )
}
