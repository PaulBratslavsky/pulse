import { fetchAllTopics } from '@/lib/strapi'
import { fetchQueue } from '@/lib/queue/fetch'
import { makeFilterUrl } from '@/lib/queue/filter-url'
import { buildCurrentSearch } from '@/lib/queue/current-search'
import { RememberQueueView } from '@/components/queue/queue-view-memory'
import { SelectionProvider, SelectionHint } from '@/components/queue/bulk-triage'
import { QueueHeader } from '@/components/queue/queue-header'
import { QueueFilters } from '@/components/queue/queue-filters'
import { QueueEmpty } from '@/components/queue/queue-empty'
import { QueueRow } from '@/components/queue/queue-row'
import { QueuePagination } from '@/components/queue/queue-pagination'
import type { TPagination, TQueueSearchParams } from '@/types'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<TQueueSearchParams>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)

  const data = await fetchQueue(params, page)
  const topics = await fetchAllTopics().catch(() => [])

  const mentions = data.data ?? []
  // The server says whether it actually grouped: it falls back to a flat list
  // when the filtered set is too large to group honestly, and the label must
  // not claim otherwise.
  const grouped = data.meta?.grouped === true
  const pagination: TPagination = data.meta?.pagination ?? {
    page: 1,
    pageCount: 1,
    total: mentions.length,
  }

  const filterUrl = makeFilterUrl(params)
  const pageUrl = (p: number) => filterUrl({ page: p })

  return (
    <div>
      <RememberQueueView search={buildCurrentSearch(params, page)} />

      <QueueHeader
        params={params}
        grouped={grouped}
        total={pagination.total}
        filterUrl={filterUrl}
      />
      <QueueFilters params={params} filterUrl={filterUrl} />

      {mentions.length === 0 ? (
        <QueueEmpty awaiting={params.awaiting} />
      ) : (
        <SelectionProvider
          allIds={mentions.map((m) => m.documentId)}
          topics={topics.map((t) => ({ documentId: t.documentId, name: t.name }))}
        >
          <div className="mb-2">
            <SelectionHint count={mentions.length} />
          </div>
          <ul className="space-y-3">
            {mentions.map((m) => (
              <QueueRow key={m.documentId} mention={m} filterUrl={filterUrl} />
            ))}
          </ul>
        </SelectionProvider>
      )}

      <QueuePagination pagination={pagination} pageUrl={pageUrl} />
    </div>
  )
}
