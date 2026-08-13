import { FilterPill } from '@/components/ui'
import SyncButton from '@/components/queue/sync-button'
import type { TQueueFilterOverrides, TQueueSearchParams } from '@/types'

export function QueueHeader({
  params,
  grouped,
  total,
  filterUrl,
}: {
  params: TQueueSearchParams
  grouped: boolean
  total: number
  filterUrl: (over: TQueueFilterOverrides) => string
}) {
  // Was a nested ternary inside the title attribute. Three different claims
  // about what the number counts, and which one is true depends on how the
  // server answered — worth a name each.
  let countTitle: string
  if (grouped) {
    countTitle = `${total} conversations — a thread of six messages is one row here`
  } else if (params.status) {
    countTitle = `${total} ${params.status} mentions`
  } else {
    countTitle = `${total} mentions still open (unanswered or claimed)`
  }

  let subject: string
  if (grouped) {
    subject = 'Conversations'
  } else if (params.status) {
    subject = `${params.status} mentions`
  } else {
    subject = 'Unanswered and claimed mentions'
  }

  const order = params.sort === 'newest' ? ', newest first.' : ', oldest first.'

  return (
    <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
      <div>
        {/* count is the whole filtered set, not this page — "how much is
            left" is the number you want at a glance, and it rides along in
            the pagination meta for free */}
        <h1 className="flex items-baseline gap-2.5 text-2xl font-semibold">
          Queue
          <span
            data-testid="queue-count"
            className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            title={countTitle}
          >
            {total}
          </span>
        </h1>
        <p className="text-sm text-zinc-500">
          {subject}
          {order}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1 text-sm" role="group" aria-label="Sort order">
          <FilterPill
            href={filterUrl({ sort: undefined, page: 0 })}
            active={params.sort !== 'newest'}
            title="Oldest first — SLA order: what has waited longest"
          >
            oldest
          </FilterPill>
          <FilterPill
            href={filterUrl({ sort: 'newest', page: 0 })}
            active={params.sort === 'newest'}
            title="Newest first — catching up on what just arrived"
          >
            newest
          </FilterPill>
        </div>
        <SyncButton />
      </div>
    </div>
  )
}
