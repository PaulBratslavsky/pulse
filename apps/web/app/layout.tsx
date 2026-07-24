import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import Providers from './providers'

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
              <form action="/api/auth/sign-out" method="post" className="ml-auto">
                <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white" formAction="/api/auth/sign-out">
                  Sign out
                </button>
              </form>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
