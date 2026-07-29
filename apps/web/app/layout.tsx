import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import { strapiFetch } from '@/lib/strapi'
import { TopNav } from '@/components/navigation/top-nav'
import { LeftSidebar } from '@/components/navigation/left-sidebar'
import { RightSidebar } from '@/components/navigation/right-sidebar'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Pulse',
  description: "The Strapi team's shared pulse on community sentiment",
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // null on /sign-in (no cookie) or if the session expired — shell degrades to bare content
  const me = await strapiFetch('/api/users/me').catch(() => null)

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the stored theme BEFORE first paint — otherwise a dark-mode
            user sees a white flash on every navigation. Must stay in sync with
            apply() in components/theme-toggle.tsx. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('pulse-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          {me ? (
            <>
              <TopNav me={me} />
              <div className="flex pt-16">
                <LeftSidebar />
                <section className="flex min-h-[calc(100vh-4rem)] flex-1 flex-col px-6 py-8 sm:px-10">
                  <div className="mx-auto w-full max-w-5xl">{children}</div>
                </section>
                <RightSidebar />
              </div>
            </>
          ) : (
            <main className="min-h-screen">{children}</main>
          )}
        </Providers>
      </body>
    </html>
  )
}
