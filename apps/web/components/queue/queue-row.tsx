import Link from 'next/link'
import { MessageSquare, MessagesSquare } from 'lucide-react'

import {
  SentimentBadge,
  StatusBadge,
  StalenessFlag,
  PostedDate,
  LaneBadge,
} from '@/components/ui/badges'
import { UserChip } from '@/components/ui'
import { commentCount } from '@/lib/mentions'
import ClaimButton from '@/components/queue/claim-button'
import MuteAuthorButton from '@/components/mention/mute-author-button'
import SpamFlagButton from '@/components/mention/spam-flag-button'
import OwnPostButton from '@/components/mention/own-post-button'
import AcknowledgeMenu from '@/components/mention/acknowledge-menu'
import { SelectCheckbox, QueueCard } from '@/components/queue/bulk-triage'
import type { TMention, TQueueFilterOverrides } from '@/types'

/** One row of the queue: what the mention is, what it says, and what you can do to it. */
export function QueueRow({
  mention: m,
  filterUrl,
}: {
  mention: TMention
  filterUrl: (over: TQueueFilterOverrides) => string
}) {
  return (
    <QueueCard documentId={m.documentId}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <SelectCheckbox documentId={m.documentId} />
        <SentimentBadge label={m.sentimentLabel} />
        <StatusBadge status={m.status} />
        <LaneBadge lane={m.lane} reason={m.laneReason} />
        <StalenessFlag
          postedAt={m.postedAt ?? m.receivedAt}
          awaitingReply={['unanswered', 'claimed'].includes(m.status)}
        />
        {/* (?? 0) not `m.threadSize &&` — a falsy 0 would render as the string
            "0" beside the badges. `undefined > 1` is false, same as before. */}
        {(m.threadSize ?? 0) > 1 && (
          <span
            className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
            title={`This row stands for a conversation of ${m.threadSize} messages. Opening it shows the whole thread.`}
          >
            <MessagesSquare size={11} />
            {m.threadSize} in thread
          </span>
        )}
        {/* The reason grouping exists: someone answered us and nobody
            answered them. Without this, the message waiting on a reply
            looks exactly like the five above it that are done. */}
        {m.awaitsReply && (
          <span
            className="inline-block rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
            title="They replied after our last answer and nobody has responded. Detected from Reddit thread structure — X and LinkedIn carry no conversation id, so this can never appear there."
          >
            waiting on us
          </span>
        )}
        {m.quality === 'suspected-spam' && (
          <span
            className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="Matched a spam heuristic — review and mute the author, or clear it"
          >
            suspected spam
          </span>
        )}
        {m.quality === 'spam' && (
          <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
            spam
          </span>
        )}
        {m.draftText && (
          <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
            draft ready
          </span>
        )}
        {commentCount(m) > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs text-zinc-500"
            title={`${commentCount(m)} comment(s)/note(s)`}
          >
            <MessageSquare size={12} /> {commentCount(m)}
          </span>
        )}
        <span className="text-xs text-zinc-500">
          @{m.authorHandle ?? 'unknown'} · {m.channel?.name ?? '—'} ·
        </span>
        <PostedDate postedAt={m.postedAt ?? m.receivedAt} />
        {(m.topics ?? []).map((t) => (
          <Link
            key={t.slug}
            href={filterUrl({ topic: t.slug, page: 0 })}
            className="text-xs text-zinc-400 hover:text-[#4945FF]"
          >
            #{t.name}
          </Link>
        ))}
      </div>
      <Link href={`/mentions/${m.documentId}`} className="block group" title="Open full mention">
        <span className="line-clamp-3 break-words group-hover:text-zinc-950 dark:group-hover:text-white">
          {m.content}
        </span>
        {m.content.length > 240 && (
          <span className="text-xs text-blue-600 group-hover:underline">Read more →</span>
        )}
      </Link>
      {/* flex-wrap, and gap-y so wrapped rows do not touch. Five controls fit
          on a tablet; the sixth did not, and an un-wrapping row widened the
          whole page instead of going to a second line. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
        {m.status === 'unanswered' && <ClaimButton documentId={m.documentId} />}
        <UserChip user={m.owner} label="Claimed by" />
        <Link
          href={`/mentions/${m.documentId}`}
          className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1"
        >
          Open
        </Link>
        {/* our own account replying to someone — recognisable from the
            handle right here, so it shouldn't cost a trip to the detail
            page and three clicks through the acknowledge panel */}
        {['unanswered', 'claimed'].includes(m.status) && (
          <OwnPostButton documentId={m.documentId} compact />
        )}
        {/* Closing without a reply, without leaving the queue. "Ours" stays
            beside it as the one-click case you hit most from here; this covers
            the other four reasons in two clicks instead of a page load and
            four. Same gate as Ours — acknowledging something already answered
            is not a thing. */}
        {['unanswered', 'claimed'].includes(m.status) && (
          <AcknowledgeMenu documentId={m.documentId} compact />
        )}
        {m.quality !== 'spam' && (
          <SpamFlagButton documentId={m.documentId} quality={m.quality} compact />
        )}
        {m.authorHandle && m.quality !== 'spam' && (
          <MuteAuthorButton handle={m.authorHandle} compact />
        )}
      </div>
    </QueueCard>
  )
}
