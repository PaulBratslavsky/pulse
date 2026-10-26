'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

/**
 * The reply you are writing, shared across the page.
 *
 * The textarea lives in the main column and the assistant lives in the sidebar,
 * so the text they both act on cannot belong to either of them. Three things
 * live here and nothing else:
 *
 *   - the draft text, edited from either side
 *   - ONE undo slot: however your words got replaced — the Refine button or an
 *     applied proposal — one click brings them back, and the UI can say which
 *     path did it rather than guessing
 *   - the conversation, so Refine can use what the assistant just established.
 *     Establishing a fact in the sidebar and then pressing a button that cannot
 *     see it is the seam this removes.
 *
 * Everything else on this screen is server state and belongs in a fetch.
 */
type Via = 'refine' | 'chat' | 'plaintext' | 'resource'

export type ChatTurn = { role: 'user' | 'assistant'; content: string; revision?: string | null }

export type Drafting = { grounded: boolean; sources: number; sourceUrls: string[] }

type ReplyDraft = {
  text: string
  setText: (t: string) => void
  /** replace the text, remembering the previous version for undo */
  replace: (next: string, via: Via) => void
  undo: () => void
  /**
   * Put `snippet` where the reply's cursor is (or at the end), as an undoable
   * change. The textarea registers itself through `textareaRef` so a panel in
   * the sidebar can insert without owning the box.
   */
  insert: (snippet: string, via: Via) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  previous: string | null
  via: Via
  chat: ChatTurn[]
  setChat: React.Dispatch<React.SetStateAction<ChatTurn[]>>
  /** the machine-written suggestion, which is NOT the reply until a human says so */
  draft: string
  setDraft: (t: string) => void
  /** whether the docs server was in play, and which pages it was allowed to cite */
  drafting: Drafting | null
  setDrafting: (d: Drafting | null) => void
}

const Ctx = createContext<ReplyDraft | null>(null)

export function ReplyDraftProvider({
  children,
  initialDraft = '',
}: {
  children: React.ReactNode
  initialDraft?: string
}) {
  const [text, setTextState] = useState('')
  const [draft, setDraft] = useState(initialDraft)
  const [drafting, setDrafting] = useState<Drafting | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const [via, setVia] = useState<Via>('refine')
  const [chat, setChat] = useState<ChatTurn[]>([])

  // A ref alongside the state so `replace` can read the current text without
  // calling setPrevious inside a state updater — React may invoke an updater
  // twice, and a double-invoked side effect there would lose the undo.
  const textRef = useRef('')
  const setText = useCallback((t: string) => {
    textRef.current = t
    setTextState(t)
  }, [])

  const replace = useCallback(
    (next: string, v: Via) => {
      setPrevious(textRef.current)
      setText(next)
      setVia(v)
    },
    [setText]
  )

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const insert = useCallback(
    (snippet: string, v: Via) => {
      const current = textRef.current
      const el = textareaRef.current
      // selectionStart survives a blur, so clicking a sidebar button still
      // knows where you were typing; no textarea (plain tab) means append
      const at = el ? Math.min(el.selectionStart ?? current.length, current.length) : current.length
      const before = current.slice(0, at)
      const after = current.slice(at)
      const lead = before && !/\s$/.test(before) ? ' ' : ''
      const trail = after && !/^\s/.test(after) ? ' ' : ''
      replace(before + lead + snippet + trail + after, v)
      const caret = (before + lead + snippet).length
      requestAnimationFrame(() => {
        if (!el) return
        el.focus()
        el.setSelectionRange(caret, caret)
      })
    },
    [replace]
  )

  const undo = useCallback(() => {
    if (previous === null) return
    setText(previous)
    setPrevious(null)
  }, [previous, setText])

  const value = useMemo(
    () => ({ text, setText, replace, undo, insert, textareaRef, previous, via, chat, setChat, draft, setDraft, drafting, setDrafting }),
    [text, setText, replace, undo, insert, previous, via, chat, draft, drafting]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReplyDraft(): ReplyDraft {
  const v = useContext(Ctx)
  if (!v) throw new Error('useReplyDraft must be used inside ReplyDraftProvider')
  return v
}
