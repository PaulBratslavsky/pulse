'use client'

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { MessagesSquare, Send, Check } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { useReplyDraft } from '@/components/reply-draft-context'
import { Spinner } from '@/components/ui'

const post = (path: string, body?: unknown) => pulseFetch('POST', path, body)

/**
 * Talk about the reply you are writing.
 *
 * "Refine" is one-shot and mute: you press it and something happens to your
 * words. You cannot say "shorter", or "they're on v4 — does this still apply?",
 * and you could not ask the docs anything without leaving the reply box, which
 * is exactly where the answer was needed. So the question got asked in another
 * window and the answer pasted back, and the reply lost its context on the way.
 *
 * The rule that keeps this honest: **an answer is not an edit.** Asking a
 * question changes nothing on screen. A change only ever arrives as a proposal
 * with an Apply button, because the risk of a friendly multi-turn assistant is
 * that it replaces your judgement with its own one small agreement at a time.
 */
export function ReplyChat({ documentId }: { documentId: string }) {
  // Reads the live textarea and writes back through the same undo slot the
  // Refine button uses; the transcript is shared so Refine can use it too.
  const { text: currentText, replace, chat: turns, setChat: setTurns } = useReplyDraft()
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState<number[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  const ask = useMutation({
    mutationFn: async (question: string) => {
      // The history sent is the conversation MINUS our local revision bookkeeping.
      const history = [...turns, { role: 'user' as const, content: question }].map((t) => ({
        role: t.role,
        content: t.content,
      }))
      const res: any = await post(`mentions/${documentId}/draft-chat`, {
        // always the CURRENT textarea, not what it held when the panel opened —
        // you can type, ask, type again, and it still knows what it is editing
        text: currentText,
        messages: history,
      })
      return res?.data as {
        reply: string | null
        revision: string | null
        grounded: boolean
        sources: number
      }
    },
    onMutate: (question: string) => {
      setTurns((t) => [...t, { role: 'user', content: question }])
      setInput('')
    },
    onSuccess: (data) => {
      setTurns((t) => [
        ...t,
        { role: 'assistant', content: data?.reply ?? '(no answer)', revision: data?.revision ?? null },
      ])
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 999999 }))
    },
  })

  const send = () => {
    const q = input.trim()
    if (q && !ask.isPending) ask.mutate(q)
  }


  return (
    // opaque background on purpose: at 50% the timeline behind it bled through
    <div
      data-testid="reply-chat"
      className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
        <MessagesSquare size={13} className="text-zinc-400" />
        Ask about this reply
      </h4>

      {turns.length === 0 && (
        <p className="mb-2 text-xs text-zinc-500">
          It can see the mention and what you have written, and it can search the Strapi docs. Ask
          a question and nothing changes; ask for an edit and you get a proposal to apply. Once
          you have talked here, <strong>Refine</strong> uses this conversation too.
        </p>
      )}

      {turns.length > 0 && (
        <div ref={listRef} className="mb-2 max-h-[55vh] space-y-2 overflow-y-auto">
          {turns.map((t, i) => (
            <div key={i}>
              <div
                className={`rounded-md px-2.5 py-1.5 text-xs whitespace-pre-wrap ${
                  t.role === 'user'
                    ? 'bg-zinc-200/70 dark:bg-zinc-800'
                    : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {t.content}
              </div>

              {/* A proposal, never an edit. Applying is a click, and the reply
                  box keeps its own undo for what was there before. */}
              {t.revision && (
                <div className="mt-1.5 rounded-md border border-violet-200 bg-violet-50 p-2 dark:border-violet-900 dark:bg-violet-950/30">
                  <p className="mb-1.5 text-[11px] font-medium text-violet-800 dark:text-violet-300">
                    Proposed reply
                  </p>
                  <p className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-200">
                    {t.revision}
                  </p>
                  <button
                    onClick={() => {
                      replace(t.revision!, 'chat')
                      setApplied((a) => [...a, i])
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white"
                  >
                    <Check size={11} />
                    {applied.includes(i) ? 'Applied — apply again' : 'Apply to my reply'}
                  </button>
                </div>
              )}
            </div>
          ))}
          {ask.isPending && (
            <p className="flex items-center gap-1.5 px-2.5 text-xs text-zinc-500">
              <Spinner size={11} /> thinking…
            </p>
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Shorter? Does this still apply in v5?…"
          aria-label="Ask about this reply"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          onClick={send}
          disabled={ask.isPending || !input.trim()}
          aria-label="Send"
          className="inline-flex items-center rounded-md border border-zinc-300 px-2.5 py-1.5 disabled:opacity-50 dark:border-zinc-700"
        >
          {ask.isPending ? <Spinner size={12} /> : <Send size={12} />}
        </button>
      </div>

      {/* Same honesty as the Refine notice: "it said so" is not "it checked". */}
      {ask.data && !ask.data.grounded && (
        <p className="mt-1.5 text-[11px] text-zinc-500">
          No documentation server is connected, so technical claims here were <strong>not</strong>{' '}
          verified. Connect one in Settings.
        </p>
      )}
      {ask.isError && <p className="mt-1.5 text-xs text-red-600">{String(ask.error)}</p>}
    </div>
  )
}
