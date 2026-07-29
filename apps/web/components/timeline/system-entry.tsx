import { ChevronRight } from 'lucide-react'
import type { SystemEntryData } from './types'

/** Compact muted system line; "answered" expands to the recorded reply
 *  (native <details> accordion — zero JS, keyboard accessible). */
export function SystemEntry({ entry, responses }: { entry: SystemEntryData; responses: any[] }) {
  const line = (
    <>
      <span className="font-medium text-zinc-600 dark:text-zinc-400">{entry.action}</span>
      {entry.actor ? ` by ${entry.actor}` : ' (system)'}
      {entry.action === 'acknowledged' && entry.detail?.reason && (
        <> — {entry.detail.reason}{entry.detail.note ? `: ${entry.detail.note}` : ''}</>
      )}
      {' · '}
      {entry.at ? new Date(entry.at).toLocaleString() : ''}
    </>
  )
  const response =
    entry.action === 'answered'
      ? (responses ?? []).find((r: any) => r.documentId === entry.detail?.responseDocumentId)
      : null

  if (response) {
    return (
      <li className="pl-1 text-xs text-zinc-500">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={12}
              className="shrink-0 translate-y-[1px] text-zinc-400 transition-transform group-open:rotate-90"
            />
            <span>
              {line}
              <span className="text-zinc-400"> · view reply</span>
            </span>
          </summary>
          <div className="ml-5 mt-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
              {response.finalText}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              outcome: <span className="font-medium">{response.outcome?.result ?? 'not recorded'}</span>
              {response.notes && <> · notes: {response.notes}</>}
            </p>
          </div>
        </details>
      </li>
    )
  }
  return (
    <li className="flex items-baseline gap-2 pl-1 text-xs text-zinc-500">
      <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-zinc-300 dark:bg-zinc-600" />
      <span>{line}</span>
    </li>
  )
}
