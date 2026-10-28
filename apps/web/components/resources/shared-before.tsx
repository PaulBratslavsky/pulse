'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { pulseFetch, PulseApiError } from '@/lib/pulse-client'
import { Spinner } from '@/components/ui'
import { MutationError } from '@/components/ui/mutation-error'
import type { TSharedBefore } from '@/types'

/**
 * "You have linked these before — save them?"
 *
 * The quickest honest start for the saved list: every post here was chosen by
 * someone answering a real question, which is a better filter than any
 * category or keyword. Found by reading the blog links in recorded replies.
 * Everything starts ticked; untick what was a one-off.
 *
 * Silent when there is nothing to offer, and when blog search is not set up
 * (503) — the Find tab already explains that.
 */
export default function SharedBefore() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [unticked, setUnticked] = useState<Set<string>>(new Set())

  const list = useQuery({
    queryKey: ['resources-shared-before'],
    queryFn: async () => (await pulseFetch<{ data: TSharedBefore[] }>('GET', 'resources/shared-before')).data,
    retry: false,
  })

  const save = useMutation({
    mutationFn: async (ids: string[]) => {
      // one at a time: each save re-reads the post from the marketing site
      for (const sourceId of ids) await pulseFetch('POST', 'resources', { sourceId })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['resources-shared-before'] })
      router.refresh()
    },
  })

  if (list.isLoading) return null
  if (list.isError) {
    if (list.error instanceof PulseApiError && list.error.status === 503) return null
    return <p className="mb-4 text-xs text-red-600">Could not check past replies for blog links: {(list.error as Error).message}</p>
  }
  const posts = list.data ?? []
  if (posts.length === 0) return null

  const selected = posts.filter((p) => !unticked.has(p.sourceId)).map((p) => p.sourceId)
  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      data-testid="shared-before"
      className="mb-5 rounded-lg border border-[#7B79FF]/40 bg-[#4945FF]/[0.04] p-4 dark:bg-[#4945FF]/10"
    >
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
        <History size={15} className="text-[#4945FF] dark:text-[#9D9BFF]" />
        <span>{`${posts.length} blog post${posts.length === 1 ? '' : 's'} you’ve linked in past replies`}</span>
      </h2>
      <p className="mb-3 text-xs text-zinc-500">
        Already chosen by someone answering a real question. Save them to have them suggested on new mentions.
      </p>
      <ul className="mb-3 space-y-1.5">
        {posts.map((p) => (
          <li key={p.sourceId} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={!unticked.has(p.sourceId)}
              onChange={() => toggle(p.sourceId)}
              aria-label={`Save ${p.title}`}
            />
            <div className="min-w-0 flex-1">
              <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline [overflow-wrap:anywhere]">
                {p.title} ↗
              </a>
              <span className="ml-2 text-xs text-zinc-500">
                linked {p.timesShared}×
                {p.lastSharedAt && <>, last {new Date(p.lastSharedAt).toLocaleDateString()}</>}
                {p.version && p.version !== 'v5' && <> · written for {p.version}</>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <button
        onClick={() => save.mutate(selected)}
        disabled={save.isPending || selected.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-[#4945FF] to-[#7B79FF] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 max-sm:min-h-[38px]"
      >
        {save.isPending && <Spinner size={12} />}
        {save.isPending ? 'Saving…' : `Save ${selected.length} selected`}
      </button>
      <MutationError m={save} className="mt-2 text-xs" />
    </div>
  )
}
