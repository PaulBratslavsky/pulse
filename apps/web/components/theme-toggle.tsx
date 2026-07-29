'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'

export type Theme = 'light' | 'dark' | 'system'
const STORAGE_KEY = 'pulse-theme'
const ORDER: Theme[] = ['light', 'dark', 'system']

const ICON = { light: Sun, dark: Moon, system: Monitor }
const LABEL = { light: 'Light', dark: 'Dark', system: 'System' }

/** Applies the resolved theme to <html>. Kept in one place so the toggle and
 *  the pre-paint script in layout.tsx can't drift apart. */
function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system'
    setTheme(stored)
    setMounted(true)
  }, [])

  // while on "system", follow OS changes live
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    setTheme(next)
    localStorage.setItem(STORAGE_KEY, next)
    apply(next)
  }

  // render the neutral icon until mounted — the server can't know the
  // stored preference, and a mismatched icon would hydrate-warn
  const Icon = mounted ? ICON[theme] : Monitor
  return (
    <button
      onClick={cycle}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
      aria-label={`Theme: ${LABEL[mounted ? theme : 'system']} — click to change`}
      title={`Theme: ${LABEL[mounted ? theme : 'system']} (click to cycle light → dark → system)`}
    >
      <Icon size={16} />
    </button>
  )
}
