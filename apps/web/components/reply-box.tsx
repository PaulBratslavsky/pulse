'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { Spinner } from '@/components/ui'
import { useReplyDraft } from '@/components/reply-draft-context'

const post = (path: string, body?: unknown) => pulseFetch('POST', path, body)

/**
 * What you actually posted.
 *
 * Split out of MentionActions so the page can put it where it belongs: beside
 * the draft panel and the assistant, which work on this exact text. The
 * moderation and correction controls stayed behind with the mention, because
 * they are about the mention rather than about the reply — mixed together they
 * were a loose row of buttons floating above a card with no relationship to it.
 */
export function ReplyBox({ mention, aiEnabled }: { mention: any; aiEnabled: boolean }) {
  const router = useRouter()
  const {
    text: finalText,
    setText: setFinalText,
    replace,
    undo,
    previous,
    via,
    chat,
    draft,
  } = useReplyDraft()
  const [notes, setNotes] = useState('')

  const respond = useMutation({
    mutationFn: () =>
      post('responses', {
        data: {
          mentionDocumentId: mention.documentId,
          finalText,
          draftText: draft || undefined,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      setFinalText('')
      setNotes('')
      router.refresh()
    },
  })

  const refine = useMutation({
    mutationFn: async () => {
      // If you have been talking to the assistant, refine uses that
      // conversation. Establishing a fact beside the box and then pressing a
      // button that cannot see it is the gap this closes.
      if (chat.length) {
        const res: any = await post(`mentions/${mention.documentId}/draft-chat`, {
          text: finalText,
          messages: [
            ...chat.map((t) => ({ role: t.role, content: t.content })),
            {
              role: 'user',
              content:
                'Now rewrite my reply, incorporating what we established above. Keep my meaning ' +
                'and my voice, and add nothing we did not verify.',
            },
          ],
        })
        return { refined: res?.data?.revision ?? null, grounded: Boolean(res?.data?.grounded) }
      }
      const res: any = await post(`mentions/${mention.documentId}/refine`, { text: finalText })
      return res?.data as { refined: string | null; grounded: boolean }
    },
    onSuccess: (res) => {
      if (!res?.refined) return
      replace(res.refined, chat.length ? 'chat' : 'refine')
    },
  })

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium">
        Record your reply (post it on the platform first — Pulse tracks it). For internal-only
        commentary, add a note in the timeline instead.
      </p>
      <textarea
        value={finalText}
        onChange={(e) => setFinalText(e.target.value)}
        placeholder="What you actually replied…"
        rows={6}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Internal notes (optional)"
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => respond.mutate()}
          disabled={respond.isPending || !finalText.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {respond.isPending && <Spinner size={12} />}
          {respond.isPending ? 'Saving…' : 'Record response'}
        </button>

        {/* Edits what YOU wrote rather than replacing it. Secondary styling on
            purpose: recording the reply is the action, this is a pass over it. */}
        {aiEnabled && (
          <button
            onClick={() => refine.mutate()}
            disabled={refine.isPending || !finalText.trim()}
            title={
              chat.length
                ? 'Rewrite your reply using what you and the assistant established alongside. Your original stays one click away.'
                : 'Improve what you wrote: check technical claims against the docs and tighten the wording. Your original stays one click away.'
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
          >
            {refine.isPending ? <Spinner size={12} /> : <Sparkles size={13} />}
            {refine.isPending ? 'Refining…' : chat.length ? 'Refine with chat' : 'Refine'}
          </button>
        )}

        {previous !== null && (
          <button onClick={undo} className="text-xs text-zinc-500 underline underline-offset-2">
            undo — restore what I wrote
          </button>
        )}
      </div>

      {/* Say plainly whether the claims were checked. Without a docs server
          connected a refine pass once preserved "MongoDB works fine" — Strapi
          supports no NoSQL database at all — so "refined" must never be read as
          "verified". */}
      {previous !== null && via === 'refine' && (
        <p className="text-xs text-zinc-500">
          {refine.data?.grounded ? (
            <>Refined and checked against the docs. Read it before posting.</>
          ) : (
            <>
              Refined for wording only — no documentation server is connected, so technical claims
              were <strong>not</strong> verified. Connect one in Settings.
            </>
          )}
        </p>
      )}
      {respond.isError && <p className="text-sm text-red-600">{String(respond.error)}</p>}
      {refine.isError && <p className="text-sm text-red-600">{String(refine.error)}</p>}
    </div>
  )
}
