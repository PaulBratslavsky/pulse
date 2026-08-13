import Link from 'next/link'
import { ExternalLink, MessagesSquare, CornerDownRight } from 'lucide-react'

export type ThreadMention = {
  documentId: string
  content: string
  authorHandle?: string | null
  postedAt?: string | null
  url?: string | null
  status?: string
  isSelf: boolean
  isOurs: boolean
}

/**
 * The rest of the conversation this mention belongs to.
 *
 * Octolens ingests every comment in a thread as its own mention, so an exchange
 * arrives as N unrelated queue rows. Reading one of them tells you nothing about
 * what was already said, or — the expensive case — that the person you answered
 * has replied again and is waiting. That happened: a Reddit follow-up sat in the
 * queue for three days while the answer was written by hand on Reddit instead.
 *
 * Server-rendered and read-only: it is context for the reply you are about to
 * write, not another thing to interact with.
 */
export function ConversationThread({
  mentions,
  venue,
}: {
  mentions: ThreadMention[]
  venue?: string | null
}) {
  if (mentions.length < 2) return null

  // The signal worth interrupting for: they said something after our last
  // reply. Anything else here is background.
  const lastOurs = mentions.map((m) => m.isOurs).lastIndexOf(true)
  const since = lastOurs === -1 ? [] : mentions.slice(lastOurs + 1).filter((m) => !m.isOurs)

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
        <MessagesSquare size={15} className="text-zinc-400" />
        Conversation
        <span className="font-normal text-zinc-500">
          {mentions.length} messages{venue ? ` in ${venue}` : ''}
        </span>
      </h2>

      {since.length > 0 && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <strong>
            {since.length} {since.length === 1 ? 'reply' : 'replies'} after your last answer
          </strong>{' '}
          — nobody has responded to {since.length === 1 ? 'it' : 'them'} yet.
        </p>
      )}

      <ol className="space-y-2">
        {mentions.map((m) => (
          <li
            key={m.documentId}
            className={`rounded-md px-3 py-2 text-xs ${
              m.isOurs
                ? 'bg-violet-50 dark:bg-violet-950/40'
                : m.isSelf
                  ? 'bg-zinc-100 dark:bg-zinc-800'
                  : 'bg-zinc-50 dark:bg-zinc-800/50'
            }`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2 text-zinc-500">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                @{m.authorHandle ?? 'unknown'}
              </span>
              {m.isOurs && <span className="text-violet-700 dark:text-violet-300">us</span>}
              {m.isSelf && !m.isOurs && <span>this one</span>}
              {m.postedAt && <span>{new Date(m.postedAt).toLocaleDateString()}</span>}
              {!m.isSelf && (
                <Link
                  href={`/mentions/${m.documentId}`}
                  className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  open
                </Link>
              )}
              {m.url && (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                >
                  source <ExternalLink size={10} />
                </a>
              )}
            </div>
            {/* trimmed hard: this is orientation, and the full text of each is
                one click away on its own page */}
            <p className="flex gap-1.5 text-zinc-600 dark:text-zinc-300">
              {!m.isSelf && <CornerDownRight size={12} className="mt-0.5 shrink-0 text-zinc-400" />}
              <span className="min-w-0 break-words">
                {m.content.length > 240 ? `${m.content.slice(0, 240).trim()}…` : m.content}
              </span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
