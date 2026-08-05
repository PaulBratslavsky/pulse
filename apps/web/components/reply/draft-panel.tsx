'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronRight, Sparkles } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { Spinner } from '@/components/ui'
import { MutationError } from '@/components/ui/mutation-error'
import { useReplyDraft } from '@/components/reply/reply-draft-context'

const post = (path: string, body?: unknown) => pulseFetch('POST', path, body)

/**
 * The machine's draft, and where it came from.
 *
 * Sits beside the assistant rather than inside the reply box, because they are
 * the same job: generate something, ask about it, revise it. The reply box is a
 * different job — recording what a human actually posted — and mixing the two
 * made the AI suggestion look like a reply already written.
 *
 * A draft is a SUGGESTION until someone clicks Use this draft. That includes
 * drafts saved from MCP or chat (pulse-save-draft), which is why this renders
 * collapsed and never touches the reply box on its own.
 */
export function DraftPanel({ documentId }: { documentId: string }) {
  const { draft, setDraft, drafting, setDrafting, setText } = useReplyDraft()
  const [showSources, setShowSources] = useState(false)

  const genDraft = useMutation({
    mutationFn: () => post(`mentions/${documentId}/draft`),
    onSuccess: (data: any) => {
      setDraft(data.data.draft)
      setDrafting({
        grounded: Boolean(data.data.grounded),
        sources: data.data.sources ?? 0,
        sourceUrls: data.data.sourceUrls ?? [],
      })
    },
  })

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <Sparkles size={13} className="text-zinc-400" />
          Docs-grounded draft
        </h4>
        <button
          onClick={() => genDraft.mutate()}
          disabled={genDraft.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-zinc-600"
        >
          {genDraft.isPending && <Spinner size={11} />}
          {genDraft.isPending ? 'Drafting…' : draft ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {!draft && !genDraft.isPending && (
        <p className="text-xs text-zinc-500">
          Nothing drafted yet. Generating writes a suggestion here — it never fills your reply until
          you say so.
        </p>
      )}

      {draft && (
        <details className="group">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs text-zinc-500 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
            <span className="font-medium">{draft.length} chars — click to read</span>
            {drafting &&
              (drafting.grounded ? (
                // Clickable, because "12 links offered" is a claim the reader
                // cannot check. These are pages the sitemap confirmed exist and
                // the model was allowed to cite — showing them is the difference
                // between provenance and a reassuring badge.
                <button
                  onClick={(e) => {
                    e.preventDefault() // don't toggle the accordion
                    setShowSources((v) => !v)
                  }}
                  className="text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
                >
                  docs searched · {drafting.sources} links
                </button>
              ) : (
                <span
                  className="text-amber-700 dark:text-amber-400"
                  title="No documentation server was connected, so technical claims were written from memory. Connect one in Settings → MCP servers."
                >
                  no docs server
                </span>
              ))}
          </summary>

          {showSources && drafting?.sourceUrls?.length ? (
            <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="mb-1.5 text-[11px] text-emerald-900 dark:text-emerald-300">
                Real documentation pages the model was allowed to cite — offered, not necessarily
                used. Check the draft for which ones it took.
              </p>
              <ul className="space-y-0.5">
                {drafting.sourceUrls.map((u) => (
                  <li key={u}>
                    <a
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-emerald-800 underline underline-offset-2 dark:text-emerald-400"
                    >
                      {u.replace(/^https?:\/\//, '')}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300">
            {draft}
          </p>
        </details>
      )}

      {draft && (
        <button
          onClick={() => setText(draft)}
          className="mt-2 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-600"
        >
          Use this draft
        </button>
      )}
      <MutationError m={genDraft} className="mt-1.5 text-xs" />
    </div>
  )
}
