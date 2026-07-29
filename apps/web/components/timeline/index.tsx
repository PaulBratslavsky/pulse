'use client'

/**
 * Unified mention timeline (GitHub-issue pattern): system events render as
 * compact muted lines, team discussion (notes + comments + feedback, one flat
 * stream — never nested) renders as message cards. Notes carry an amber
 * accent (Zendesk convention), feedback teal. Composer sits at the bottom,
 * chat-style, oldest first.
 */
import { SystemEntry } from './system-entry'
import { DiscussionCard } from './discussion-card'
import { Composer } from './composer'
import type { Entry } from './types'

export default function Timeline({ mention, meDocumentId }: { mention: any; meDocumentId?: string | null }) {
  const entries: Entry[] = [
    ...(mention.activities ?? []).map((a: any) => ({
      type: 'system' as const,
      at: a.at,
      action: a.action,
      actor: a.actor?.username ?? null,
      detail: a.detail,
    })),
    ...(Array.isArray(mention.comments) ? mention.comments : []).map((c: any) => ({
      type: 'discussion' as const,
      at: c.createdAt,
      kind: c.kind,
      body: c.body,
      links: Array.isArray(c.links) ? c.links : [],
      author: c.author?.username ?? null,
      authorDocumentId: c.author?.documentId ?? null,
      edited: Boolean(c.editedAt), // stamped by the update controller — no timestamp inference
      id: c.documentId,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return (
    <div>
      <h2 className="font-medium mb-3">Timeline</h2>
      <ol className="space-y-3">
        {entries.length === 0 && <li className="text-sm text-zinc-500">No activity yet.</li>}
        {entries.map((e, i) =>
          e.type === 'system' ? (
            <SystemEntry key={`s-${i}`} entry={e} responses={mention.responses ?? []} />
          ) : (
            <DiscussionCard key={e.id} entry={e} mine={Boolean(meDocumentId && e.authorDocumentId === meDocumentId)} />
          )
        )}
      </ol>
      <Composer mentionDocumentId={mention.documentId} />
    </div>
  )
}
