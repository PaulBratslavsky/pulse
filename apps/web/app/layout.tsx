import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import Providers from './providers'
import { strapiFetch } from '@/lib/strapi'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Pulse',
  description: "The Strapi team's shared pulse on community sentiment",
}

const nav = [
  { href: '/', label: 'Queue' },
  { href: '/trends', label: 'Trends' },
  { href: '/themes', label: 'Themes' },
  { href: '/chat', label: 'Chat' },
  { href: '/settings', label: 'Settings' },
]

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // null on /sign-in (no cookie) or if the session expired — header degrades gracefully
  const me = await strapiFetch('/api/users/me').catch(() => null)

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
              <Link href="/" className="font-semibold tracking-tight">
                🫀 Pulse
              </Link>
              <nav className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-300">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="hover:text-zinc-950 dark:hover:text-white">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3">
                {me?.username && (
                  <span className="text-sm text-zinc-600 dark:text-zinc-300">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-xs font-semibold mr-1.5 align-middle">
                      {me.username.charAt(0).toUpperCase()}
                    </span>
                    {me.username}
                  </span>
                )}
                {me && (
                  <form action="/api/auth/sign-out" method="post">
                    <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white" formAction="/api/auth/sign-out">
                      Sign out
                    </button>
                  </form>
                )}
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
