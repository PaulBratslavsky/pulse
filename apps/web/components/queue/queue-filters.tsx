import Link from 'next/link'

import { FilterPill, FilterRow } from '@/components/ui'
import type { TQueueFilterOverrides, TQueueSearchParams } from '@/types'

/**
 * One row per axis. Everything used to share two wrapping rows, so a
 * group could split across lines — "monitor" and "all lanes" ended up
 * orphaned from "reply work" — and the labels couldn't rescue it. A
 * fixed label column makes the rows scan vertically.
 */
export function QueueFilters({
  params,
  filterUrl,
}: {
  params: TQueueSearchParams
  filterUrl: (over: TQueueFilterOverrides) => string
}) {
  return (
    <div className="mb-4 space-y-1.5 text-sm">
      {/* active topic sits above the axes — it comes from elsewhere (a theme
          or a chip) and clearing it is a distinct action */}
      {params.topic && (
        <FilterRow label="topic">
          <Link
            href={filterUrl({ topic: undefined, page: 0 })}
            className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#4945FF] to-[#7B79FF] px-3 py-1 font-medium text-white"
            title="Clear topic filter"
          >
            #{params.topic} ✕
          </Link>
        </FilterRow>
      )}
      <FilterRow label="status">
        {['', 'unanswered', 'claimed', 'answered', 'acknowledged', 'resolved'].map((v) => (
          <FilterPill
            key={v || 'queue'}
            href={filterUrl({ status: v || undefined, page: 0 })}
            active={(params.status ?? '') === v}
          >
            {v || 'queue'}
          </FilterPill>
        ))}
      </FilterRow>

      <FilterRow label="lane">
        <FilterPill
          href={filterUrl({ lane: 'all', page: 0 })}
          active={params.lane === 'all'}
          title="Every lane at once — the whole corpus, routed or not"
        >
          all lanes
        </FilterPill>
        <FilterPill
          href={filterUrl({ lane: undefined, page: 0 })}
          active={!params.lane}
          title="Reply work: mentions naming Strapi, plus people shopping or leaving a competitor"
        >
          reply work
        </FilterPill>
        <FilterPill
          href={filterUrl({ lane: 'lead', page: 0 })}
          active={params.lane === 'lead'}
          activeClassName="border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
          title="Someone actively switching or evaluating — usually names no Strapi keyword at all"
        >
          leads
        </FilterPill>
        <FilterPill
          href={filterUrl({ lane: 'monitor', page: 0 })}
          active={params.lane === 'monitor'}
          title="Competitor and industry discourse — kept for trends and themes, not reply work"
        >
          monitor
        </FilterPill>
      </FilterRow>

      {/* Grouping is a view, not a filter — it changes what a ROW is, not
          which mentions qualify. Kept visible rather than tucked away,
          because a queue that quietly shows fewer rows than there are
          mentions has to say so. */}
      <FilterRow label="show">
        <FilterPill
          href={filterUrl({ every: undefined, page: 0 })}
          active={!params.every}
          title="One row per conversation: a thread of six messages is one job, not six"
        >
          conversations
        </FilterPill>
        <FilterPill
          href={filterUrl({ every: '1', page: 0 })}
          active={Boolean(params.every)}
          title="One row per message, including every reply in a thread"
        >
          every message
        </FilterPill>
      </FilterRow>

      <FilterRow label="sentiment">
        {['', 'negative', 'neutral', 'positive', 'na'].map((v) => (
          <FilterPill
            key={v || 'all'}
            href={filterUrl({ sentiment: v || undefined, page: 0 })}
            active={(params.sentiment ?? '') === v}
          >
            {v === 'na' ? 'n/a' : v || 'all'}
          </FilterPill>
        ))}
      </FilterRow>

      <FilterRow label="flags">
        {/* First, and coloured like an alert: this is the only flag that means
            a named person is waiting on an answer they asked us for. The rest
            describe the mention; this one describes a debt. */}
        <FilterPill
          href={filterUrl({ awaiting: params.awaiting ? undefined : '1', page: 0 })}
          active={Boolean(params.awaiting)}
          activeClassName="border-red-500 bg-red-50 font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300"
          title="Someone replied after our last answer in the same thread, and nobody has responded to them. Reddit only — X and LinkedIn URLs carry no conversation id, so replies there cannot be detected."
        >
          awaiting reply
        </FilterPill>
        {params.awaiting && <span className="text-xs text-zinc-500">Reddit threads only</span>}
        <FilterPill
          href={filterUrl({ draft: params.draft ? undefined : '1', page: 0 })}
          active={Boolean(params.draft)}
          activeClassName="border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-900/30 dark:text-sky-300"
          title="Only mentions with a saved draft reply — the review backlog"
        >
          has draft
        </FilterPill>
        <FilterPill
          href={filterUrl({ q: params.q ? undefined : 'strapi', page: 0 })}
          active={Boolean(params.q)}
          activeClassName="border-[#4945FF] bg-[#4945FF]/10 font-medium text-[#4945FF]"
          title="Only mentions whose text actually says Strapi"
        >
          mentions Strapi
        </FilterPill>
        <FilterPill
          href={filterUrl({ topics: params.topics === 'none' ? undefined : 'none', page: 0 })}
          active={params.topics === 'none'}
          title="Mentions with no topics yet — the set worth a bulk topic pass"
        >
          no topics
        </FilterPill>
        <FilterPill
          href={filterUrl({
            quality: params.quality === 'suspected-spam' ? undefined : 'suspected-spam',
            page: 0,
          })}
          active={params.quality === 'suspected-spam'}
          activeClassName="border-amber-500 bg-amber-50 font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          title="Heuristic spam hits awaiting review"
        >
          suspected spam
        </FilterPill>
        <FilterPill
          href={filterUrl({ quality: params.quality === 'spam' ? undefined : 'spam', page: 0 })}
          active={params.quality === 'spam'}
          activeClassName="border-red-500 bg-red-50 font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300"
          title="Muted authors / confirmed spam — hidden from the queue and all reports"
        >
          spam
        </FilterPill>
      </FilterRow>
    </div>
  )
}
