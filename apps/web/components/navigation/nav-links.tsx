'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Inbox, TrendingUp, Tags, MessagesSquare, Settings, FileBarChart, MessageSquareHeart, Share2, Target } from 'lucide-react'

const links = [
  { href: '/', label: 'Queue', Icon: Inbox },
  // directly under Queue: leads are work, not analysis — they belong beside
  // the other thing a person acts on, not down with the reporting surfaces
  { href: '/leads', label: 'Leads', Icon: Target },
  { href: '/trends', label: 'Trends', Icon: TrendingUp },
  { href: '/themes', label: 'Themes', Icon: Tags },
  { href: '/feedback', label: 'Feedback', Icon: MessageSquareHeart },
  { href: '/insights', label: 'Insights', Icon: FileBarChart },
  { href: '/graph', label: 'Map', Icon: Share2 },
  { href: '/chat', label: 'Chat', Icon: MessagesSquare },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-2">
      {links.map(({ href, label, Icon }) => {
        const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className={
              isActive
                ? 'flex items-center gap-3 rounded-lg px-4 py-3 bg-gradient-to-r from-[#4945FF] to-[#7B79FF] text-white font-semibold shadow-sm'
                : 'flex items-center gap-3 rounded-lg px-4 py-3 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium'
            }
          >
            <Icon size={18} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
