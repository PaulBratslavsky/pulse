'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { NavLinks } from './nav-links'

/**
 * Phone navigation. The left sidebar is `max-sm:hidden`, so without this a
 * phone can reach nothing but the queue — every other page becomes
 * unreachable. A drawer (rather than a bottom tab bar) because there are seven
 * destinations; five would fit a tab bar, seven would not.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // a tap that navigates must also dismiss the drawer
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    // lock the page behind the drawer, or iOS scrolls the body under it
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      // return focus to the hamburger so keyboard/switch users aren't dumped
      // at the top of the document
      triggerRef.current?.focus()
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="-ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:hidden"
      >
        <Menu size={22} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] sm:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute left-0 top-0 flex h-full w-[min(82vw,17rem)] flex-col overflow-y-auto bg-white p-4 shadow-xl outline-none dark:bg-zinc-900"
            style={{
              paddingTop: 'max(1rem, env(safe-area-inset-top))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-bold">
                Strapi <span className="text-[#4945FF]">Pulse</span>
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X size={20} />
              </button>
            </div>
            <NavLinks />
          </div>
        </div>
      )}
    </>
  )
}
