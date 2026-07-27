import { NavLinks } from './nav-links'

export function LeftSidebar() {
  return (
    <aside className="sticky left-0 top-16 flex h-[calc(100vh-4rem)] w-[240px] shrink-0 flex-col justify-between overflow-y-auto bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 p-4 pt-10 max-sm:hidden">
      <NavLinks />
    </aside>
  )
}
