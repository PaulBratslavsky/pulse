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
}: {
  name?: string | null
  size?: keyof typeof AVATAR_SIZES
  muted?: boolean
}) {
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
      className={`rounded-full px-3 py-1 border ${
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
