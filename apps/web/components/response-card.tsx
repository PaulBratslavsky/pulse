'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'
import { Spinner } from '@/components/ui'

/**
 * A recorded reply, correctable.
 *
 * A response is a transcription of something that lives on another platform,
 * so it goes stale in ways a note never does — a typo made while pasting it
 * back, or an edit made on the platform afterwards. Left uncorrectable, the
 * record and the reality drift apart, and the record is what the team reads.
 *
 * Editing shows "(edited)" for the same reason comments do: outcome and
 * sentiment were recorded against what was ACTUALLY said, so a corrected reply
 * must never be able to pass as the original wording.
 *
 * Only the person who recorded it can change it — the server enforces this too.
 * A response is a claim about what a named person posted publicly; someone else
 * rewriting it is a different act from fixing a shared note.
 */
export default function ResponseCard({
  response,
  canEdit,
  className,
  children,
}: {
  response: any
  canEdit: boolean
  /** the <li> is rendered HERE, not by the parent: withdrawing removes the row
   *  entirely, and a wrapper owned by the server component would be left behind
   *  as an empty bordered box */
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  // Removed locally once the server confirms, rather than waiting for the
  // refetch to drop the row. router.refresh() reliably brings back EDITED text
  // — the edit path proves that — but did not consistently retire the withdrawn
  // card, and a Withdraw that appears to do nothing until you reload reads as
  // broken. The server has already agreed by the time this is set.
  const [withdrawn, setWithdrawn] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [text, setText] = useState(response.finalText ?? '')
  const [notes, setNotes] = useState(response.notes ?? '')

  const save = useMutation({
    mutationFn: () =>
      pulseFetch('PUT', `responses/${response.documentId}`, { finalText: text, notes }),
    onSuccess: () => {
      setEditing(false)
      router.refresh()
    },
  })

  const withdraw = useMutation({
    mutationFn: () => pulseFetch('DELETE', `responses/${response.documentId}`),
    onSuccess: () => {
      setWithdrawn(true)
      router.refresh()
    },
  })

  if (withdrawn) return null

  if (editing) {
    return (
      <li className={`${className} space-y-2`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          aria-label="Recorded reply"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes (optional)"
          aria-label="Internal notes"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !text.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {save.isPending && <Spinner size={12} />}
            Save
          </button>
          <button
            onClick={() => {
              setText(response.finalText ?? '')
              setNotes(response.notes ?? '')
              setEditing(false)
            }}
            className="text-xs text-zinc-500 underline underline-offset-2"
          >
            Cancel
          </button>
          <MutationError m={save} className="text-xs" />
        </div>
      </li>
    )
  }

  return (
    <li className={className}>
      {children}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button
            onClick={() => setEditing(true)}
            className="text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Edit
          </button>
          {/* two steps, no browser dialog — the same inline confirm the
              timeline uses, because a native confirm() blocks the whole page */}
          {confirming ? (
            <button
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending}
              className="inline-flex items-center gap-1.5 text-red-600 underline underline-offset-2 disabled:opacity-50"
            >
              {withdraw.isPending && <Spinner size={11} />}
              Withdraw?
            </button>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-zinc-500 underline underline-offset-2 hover:text-red-600"
              title="Removes this from the record. It stays in the database and the mention's status is left alone."
            >
              Withdraw
            </button>
          )}
          <MutationError m={withdraw} className="text-xs" />
        </div>
      )}
    </li>
  )
}
