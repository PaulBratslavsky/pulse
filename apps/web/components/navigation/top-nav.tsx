import Link from 'next/link'
import SearchBox from '@/components/search-box'
import { logoutUserAction } from '@/data/actions/auth'

export function TopNav({ me }: { me: { username: string } | null }) {
  return (
    <nav className="fixed top-0 z-50 flex w-full items-center gap-5 bg-white dark:bg-zinc-900 p-4 sm:px-10 shadow-sm dark:shadow-none border-b border-zinc-200 dark:border-zinc-800">
      <Link href="/" className="flex items-center gap-1 shrink-0">
        <span className="text-xl">🫀</span>
        <p className="text-xl font-bold max-sm:hidden">
          Pu<span className="text-rose-500">lse</span>
        </p>
      </Link>

      <div className="flex-1 flex justify-center">
        <SearchBox />
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {me && (
          <>
            <span className="text-sm text-zinc-600 dark:text-zinc-300 max-sm:hidden">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-r from-rose-500 to-orange-400 text-white text-xs font-semibold mr-1.5 align-middle">
                {me.username.charAt(0).toUpperCase()}
              </span>
              {me.username}
            </span>
            <form action={logoutUserAction}>
              <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </nav>
  )
}
