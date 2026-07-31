import Link from 'next/link'
import type { UserRef } from '@/lib/types'

/** Shared UI atoms (review 2026-07-28: gradient avatar ×4, claimed-chip ×3,
 *  empty-state card ×6, filter pill ×4 were inlined copies). */

const AVATAR_SIZES = {
  xs: 'h-4 w-4 text-[9px]',
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-6 w-6 text-[10px]',
  lg: 'h-7 w-7 text-xs',
} as const

export function Avatar({
  name,
  size = 'md',
  muted = false,
  src,
}: {
  name?: string | null
  size?: keyof typeof AVATAR_SIZES
  muted?: boolean
  /** real profile picture when we have one — plain <img>, not next/image, so
   *  an arbitrary social CDN doesn't need adding to the remote-patterns config
   *  (and a broken URL degrades to the initial rather than throwing) */
  src?: string | null
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? ''}
        loading="lazy"
        className={`inline-block shrink-0 rounded-full object-cover ${AVATAR_SIZES[size]} ${muted ? 'opacity-60' : ''}`}
      />
    )
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${AVATAR_SIZES[size]} ${
        muted ? 'bg-zinc-400' : 'bg-gradient-to-r from-[#4945FF] to-[#7B79FF]'
      }`}
    >
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}

export function UserChip({
  user,
  label,
  muted = false,
  size = 'sm',
}: {
  user: UserRef | null | undefined
  label: string
  muted?: boolean
  size?: 'xs' | 'sm'
}) {
  if (!user) return null
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 ${
        size === 'xs' ? 'px-2.5 py-1 text-xs' : 'px-2.5 py-1 text-sm'
      }`}
    >
      <Avatar name={user.username} size={size === 'xs' ? 'xs' : 'sm'} muted={muted} />
      {label} <strong>{user.username}</strong>
    </span>
  )
}

export function FilterPill({
  href,
  active,
  children,
  title,
  activeClassName,
}: {
  href: string
  active: boolean
  children: React.ReactNode
  title?: string
  activeClassName?: string
}) {
  return (
    <Link
      href={href}
      title={title}
      // taller tap area under sm: the desktop pill is ~26px, well under the
      // 44px iOS / 48dp Android minimum, and the queue stacks ~17 of them
      className={`inline-flex items-center rounded-full border px-3 py-1 max-sm:min-h-[38px] max-sm:px-3.5 ${
        active
          ? (activeClassName ?? 'border-zinc-900 dark:border-white font-medium')
          : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
      }`}
    >
      {children}
    </Link>
  )
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
      {icon}
      <p className="text-lg font-medium mb-2">{title}</p>
      {children}
    </div>
  )
}

/**
 * Inline busy indicator for pending mutations. The buttons were already
 * `disabled` while in flight — the double-submit guard existed — but with no
 * visual change a slow request looks like a dead button, which is exactly what
 * makes people click again.
 *
 * `currentColor` so it inherits the button's text colour in both themes, and
 * aria-hidden because the accompanying label already changes ("Claiming…").
 */
export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * One filter axis: a fixed-width label column plus its pills.
 *
 * The queue's filters previously shared two wrapping rows, so a group could
 * split mid-way — "monitor" and "all lanes" ended up on a different line from
 * "reply work", which made a lane look like a sentiment. A dedicated row per
 * axis with an aligned label column means the groups can never interleave, and
 * the whole block scans vertically.
 *
 * The label column collapses under `sm`: on a phone it would eat a third of
 * the width, and the pills wrap under it instead.
 */
export function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* w-24: "SENTIMENT" at this size is ~76px and was overrunning a 64px
          column straight into the first pill. Sized to the longest label so
          every row's pills start on the same vertical line. */}
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-400 max-sm:w-full">
        {label}
      </span>
      {children}
    </div>
  )
}
