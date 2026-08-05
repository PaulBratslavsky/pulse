'use client'

/** Renders a mutation's failure — every mutation in the app must surface its
 *  error (review: four of them failed in complete silence). */
export function MutationError({ m, className = '' }: { m: { isError: boolean; error: unknown }; className?: string }) {
  if (!m.isError) return null
  const msg = m.error instanceof Error ? m.error.message : String(m.error)
  return <p className={`text-sm text-red-600 ${className}`}>{msg}</p>
}
