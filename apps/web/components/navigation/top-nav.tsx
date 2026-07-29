import Link from 'next/link'
import { LogOut } from 'lucide-react'
import SearchBox from '@/components/search-box'
import { Avatar } from '@/components/ui'
import { logoutUserAction } from '@/data/actions/auth'

export function TopNav({ me }: { me: { username: string } | null }) {
  return (
    <nav className="fixed top-0 z-50 flex w-full items-center gap-5 bg-white dark:bg-zinc-900 p-4 sm:px-10 shadow-sm dark:shadow-none border-b border-zinc-200 dark:border-zinc-800">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        {/* official Strapi 2022 mark, extracted from @strapi/admin */}
        <img src="/strapi-logo.svg" alt="Strapi" className="h-7 w-7" />
        <p className="text-xl font-bold max-sm:hidden">
          Strapi <span className="text-[#4945FF]">Pulse</span>
        </p>
      </Link>

      <div className="flex-1 flex justify-center">
        <SearchBox />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {me && (
          <>
            <Avatar name={me.username} size="lg" />
            <span className="text-sm text-zinc-600 dark:text-zinc-300 max-sm:hidden">{me.username}</span>
            <form action={logoutUserAction} className="flex">
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </form>
          </>
        )}
      </div>
    </nav>
  )
}
