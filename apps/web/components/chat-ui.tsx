'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

type Msg = { role: 'user' | 'assistant'; content: string }

export default function ChatUI() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')

  const ask = useMutation({
    mutationFn: async (all: Msg[]) => {
      const res = await fetch('/api/pulse/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: all }),
      })
      if (!res.ok) throw new Error('chat failed')
      return (await res.json()).data
    },
    onSuccess: (data) => setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    const next: Msg[] = [...messages, { role: 'user' as const, content: input }]
    setMessages(next)
    setInput('')
    ask.mutate(next)
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Chat with the data</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Ask about sentiment, themes, or the queue — e.g. “what were the top negative themes this
        month?”
      </p>

      <div className="space-y-3 mb-4">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
            Answers are grounded in Pulse&apos;s own data (score, themes, queue counts).
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg p-3 text-sm whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 ml-12'
                : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 mr-12'
            }`}
          >
            {m.content}
          </div>
        ))}
        {ask.isPending && <p className="text-sm text-zinc-400">Thinking…</p>}
        {ask.isError && <p className="text-sm text-red-600">{String(ask.error)}</p>}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Pulse…"
          className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        />
        <button
          disabled={ask.isPending}
          className="rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}
