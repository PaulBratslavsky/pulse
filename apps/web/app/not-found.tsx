import Link from 'next/link'
import { SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center mt-8">
      <SearchX className="mx-auto mb-4 text-zinc-400" size={40} />
      <p className="text-lg font-medium mb-2">Nothing here</p>
      <p className="text-sm text-zinc-500 mb-6">
        That mention may have been merged as a duplicate, or the link is stale.
      </p>
      <Link
        href="/"
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
      >
        Back to the queue
      </Link>
    </div>
  )
}
