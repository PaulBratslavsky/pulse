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
type Via = 'refine' | 'chat'

export type ChatTurn = { role: 'user' | 'assistant'; content: string; revision?: string | null }

type ReplyDraft = {
  text: string
  setText: (t: string) => void
  /** replace the text, remembering the previous version for undo */
  replace: (next: string, via: Via) => void
  undo: () => void
  previous: string | null
  via: Via
  chat: ChatTurn[]
  setChat: React.Dispatch<React.SetStateAction<ChatTurn[]>>
}

const Ctx = createContext<ReplyDraft | null>(null)

export function ReplyDraftProvider({ children }: { children: React.ReactNode }) {
  const [text, setTextState] = useState('')
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

  const undo = useCallback(() => {
    if (previous === null) return
    setText(previous)
    setPrevious(null)
  }, [previous, setText])

  const value = useMemo(
    () => ({ text, setText, replace, undo, previous, via, chat, setChat }),
    [text, setText, replace, undo, previous, via, chat]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReplyDraft(): ReplyDraft {
  const v = useContext(Ctx)
  if (!v) throw new Error('useReplyDraft must be used inside ReplyDraftProvider')
  return v
}
