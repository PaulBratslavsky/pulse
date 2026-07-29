/** Route-level skeleton: neutral card rows (queue-shaped, harmless elsewhere). */
export default function Loading() {
  return (
    <div className="space-y-3 mt-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
        />
      ))}
    </div>
  )
}
