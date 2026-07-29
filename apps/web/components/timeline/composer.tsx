'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'
import { KIND_META, type Kind } from './kind-meta'
import { LinkListEditor } from './link-list-editor'

/** Bottom composer (chat model): kind toggle → textarea → links → submit. */
export function Composer({ mentionDocumentId }: { mentionDocumentId: string }) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('comment')
  const [body, setBody] = useState('')
  const [links, setLinks] = useState<string[]>([])

  const submit = useMutation({
    mutationFn: () => pulseFetch('POST', 'comments', { data: { mentionDocumentId, kind, body, links } }),
    onSuccess: () => {
      setBody('')
      setLinks([])
      setKind('comment')
      router.refresh()
    },
  })

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex gap-1.5 text-xs flex-wrap">
        {(Object.keys(KIND_META) as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-full border px-2.5 py-1 ${
              kind === k ? KIND_META[k].active : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
            }`}
          >
            {KIND_META[k].chip}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={KIND_META[kind].placeholder}
        rows={kind === 'comment' ? 2 : 3}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <LinkListEditor links={links} onChange={setLinks} />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={() => submit.mutate()}
          disabled={submit.isPending || !body.trim()}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {submit.isPending ? 'Saving…' : KIND_META[kind].submit}
        </button>
        <MutationError m={submit} />
      </div>
    </div>
  )
}
