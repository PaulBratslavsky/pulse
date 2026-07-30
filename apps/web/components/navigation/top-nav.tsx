import Link from 'next/link'
import { LogOut } from 'lucide-react'
import SearchBox from '@/components/search-box'
import { Avatar } from '@/components/ui'
import ThemeToggle from '@/components/theme-toggle'
import { MobileNav } from './mobile-nav'
import { logoutUserAction } from '@/data/actions/auth'

export function TopNav({ me }: { me: { username: string } | null }) {
  return (
    <nav
      className="fixed top-0 z-50 flex w-full items-center gap-2 border-b border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none sm:gap-5 sm:p-4 sm:px-10"
      // keep the bar clear of the notch in landscape, where the inset is
      // horizontal rather than vertical
      style={{
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
      }}
    >
      <MobileNav />

      <Link href="/" className="flex shrink-0 items-center gap-2">
        {/* official Strapi 2022 mark, extracted from @strapi/admin */}
        <img src="/strapi-logo.svg" alt="Strapi" className="h-7 w-7" />
        <p className="text-xl font-bold max-sm:hidden">
          Strapi <span className="text-[#4945FF]">Pulse</span>
        </p>
      </Link>

      {/* min-w-0 so the search input can shrink instead of forcing the bar
          wider than the screen */}
      <div className="flex min-w-0 flex-1 justify-center">
        <SearchBox />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <ThemeToggle />
        {me && (
          <>
            {/* the avatar is redundant with the username on a phone, and the
                bar is the tightest row in the app — drop it under sm */}
            <span className="max-sm:hidden">
              <Avatar name={me.username} size="lg" />
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-300 max-sm:hidden">{me.username}</span>
            <form action={logoutUserAction} className="flex">
              <button
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white sm:h-8 sm:w-8"
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
