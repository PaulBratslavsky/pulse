'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown } from 'lucide-react'

import { pulseFetch, PulseApiError } from '@/lib/pulse-client'
import { ACK_REASONS, type TAckReason } from '@/lib/acknowledge-reasons'
import { MutationError } from '@/components/ui/mutation-error'
import { Spinner } from '@/components/ui'

/**
 * Close a mention without replying, from the card.
 *
 * Two clicks — open, pick a reason — against four and a page load through the
 * detail panel. Deliberately no note field: the note is the reason the detail
 * panel exists, and adding it here would turn a menu into a form and cost the
 * click this exists to save.
 *
 * Hits the same endpoint as everywhere else, so the acting user is recorded and
 * an unowned mention is adopted on the way out — acknowledging from the queue
 * attributes exactly as acknowledging from the detail page does.
 */
export default function AcknowledgeMenu({
  documentId,
  compact = false,
}: {
  documentId: string
  compact?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const ack = useMutation({
    mutationFn: (reason: TAckReason) =>
      pulseFetch('POST', `mentions/${documentId}/acknowledge`, { reason }),
    onSuccess: () => {
      setOpen(false)
      router.refresh()
    },
    // 409 = someone already closed it; show reality rather than an error
    onError: (err) => {
      if (err instanceof PulseApiError && err.status === 409) {
        setOpen(false)
        router.refresh()
      }
    },
  })

  // A menu that only closes by choosing something is a trap — you opened it to
  // look. Escape and a click elsewhere both back out.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const size = compact ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'

  return (
    <span className="inline-flex items-center gap-1">
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={ack.isPending}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`inline-flex items-center gap-1 rounded-md border border-zinc-300 text-zinc-500 hover:border-violet-400 hover:text-violet-700 disabled:opacity-50 dark:border-zinc-700 dark:hover:text-violet-300 ${size} max-sm:min-h-[38px]`}
          title="Close this without a public reply — it keeps feeding trends, themes and reports"
        >
          {ack.isPending ? (
            <Spinner size={compact ? 11 : 12} />
          ) : (
            <CheckCircle2 size={compact ? 11 : 14} />
          )}
          {ack.isPending ? 'Closing…' : 'Acknowledge'}
          <ChevronDown size={compact ? 10 : 12} className={open ? 'rotate-180' : ''} />
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Acknowledge reason"
            className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <p className="px-3 py-1.5 text-[11px] leading-snug text-zinc-500">
              Leaves the queue, keeps counting in trends and themes.
            </p>
            {ACK_REASONS.map((r) => (
              <button
                key={r.value}
                role="menuitem"
                onClick={() => ack.mutate(r.value)}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="font-medium">{r.label}</span>
                {r.hint && <span className="block text-[11px] text-zinc-500">{r.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <MutationError m={ack} className="text-xs" />
    </span>
  )
}
