'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { IdCard, Check, AlertTriangle, Sparkles, Quote } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'
import { Spinner } from '@/components/ui'

export type LeadProfile = {
  email?: string | null
  company?: string | null
  companyDomain?: string | null
  role?: string | null
  intentSummary?: string | null
  sources?: Record<string, string> | null
  startedAt?: string | null
  researchedAt?: string | null
  researchedBy?: { username?: string } | null
}

type Suggestion = {
  field: 'company' | 'role'
  value: string
  /** the author's own words, verified server-side to appear in the post */
  evidence: string
  url?: string | null
}

const FIELDS = [
  { key: 'email', label: 'Email', placeholder: 'name@company.com', hint: 'the one thing that makes a lead reachable' },
  { key: 'company', label: 'Company', placeholder: 'Acme Inc' },
  { key: 'companyDomain', label: 'Domain', placeholder: 'acme.com' },
  { key: 'role', label: 'Role', placeholder: 'Head of Engineering' },
] as const

/**
 * The worked profile — everything Pulse cannot learn from a social post.
 *
 * Nothing here is created automatically, and that is the design rather than a
 * limitation. Scoring runs on everyone because it is free and reversible;
 * a profile is a person deciding someone is worth the next half hour, so
 * STARTING one IS the pre-qualification. No separate flag, because a flag and a
 * record can disagree and then neither is trusted.
 *
 * Octolens gives us a handle, a display name, an avatar and a follower count —
 * no email, company or role exists anywhere in the pipeline. Every field below
 * is therefore typed by a human, and stamped with who typed it.
 */
export default function LeadProfilePanel({
  documentId,
  profile,
  status,
  defaultOpen = false,
}: {
  documentId: string
  profile: LeadProfile | null
  status: string
  /** arrive from a mention with ?profile=1 and the form is already open */
  defaultOpen?: boolean
}) {
  const router = useRouter()
  const started = Boolean(profile?.startedAt)
  const [open, setOpen] = useState(started || defaultOpen)
  const [form, setForm] = useState({
    email: profile?.email ?? '',
    company: profile?.company ?? '',
    companyDomain: profile?.companyDomain ?? '',
    role: profile?.role ?? '',
    intentSummary: profile?.intentSummary ?? '',
  })

  // Which fields came from a suggestion rather than from typing. Tracked per
  // field because a save normally mixes the two, and the provenance has to
  // describe each value rather than the request that carried them.
  const [inferred, setInferred] = useState<Record<string, boolean>>({})

  const save = useMutation({
    mutationFn: () =>
      pulseFetch('PUT', `people/${documentId}/lead-profile`, {
        ...form,
        sources: Object.fromEntries(
          Object.entries(inferred)
            .filter(([, v]) => v)
            .map(([k]) => [k, 'inferred'])
        ),
      }),
    onSuccess: () => router.refresh(),
  })

  /**
   * Read their posts for company/role. Suggestions only — nothing is written
   * until you click one, and clicking marks that field `inferred` rather than
   * `human`, so a guess can never be mistaken later for something you checked.
   */
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const suggest = useMutation({
    mutationFn: () => pulseFetch('POST', `people/${documentId}/suggest-identity`),
    onSuccess: (res: any) => setSuggestions(res.data ?? []),
  })

  if (!started && !open) {
    return (
      <div className="mb-6 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <h2 className="mb-1 flex items-center gap-2 font-medium">
          <IdCard size={16} className="text-zinc-400" />
          No profile yet
        </h2>
        <p className="mb-3 text-sm text-zinc-500">
          Pulse knows what this person said and where. It does not know who they are or how to
          reach them — social posts carry no email, company or role. Starting a profile is you
          saying this one is worth that work.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          Start a profile
        </button>
      </div>
    )
  }

  const hasEmail = Boolean(form.email.trim())

  return (
    <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <IdCard size={16} className="text-zinc-400" />
        Lead profile
      </h2>

      {/* Readiness, stated plainly — the gate should never be a mystery. */}
      <p
        className={`mb-4 flex items-center gap-1.5 text-sm ${
          hasEmail ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
        }`}
      >
        {hasEmail ? <Check size={14} /> : <AlertTriangle size={14} />}
        {hasEmail
          ? status === 'qualified'
            ? 'Reachable and qualified.'
            : 'Reachable. Mark them qualified once you have vouched for them.'
          : 'Add an email to make this actionable — without one there is no way to reach them.'}
      </p>

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="text-xs text-zinc-500">{f.label}</span>
            <input
              value={form[f.key]}
              onChange={(e) => {
                setForm((s) => ({ ...s, [f.key]: e.target.value }))
                // typed over: it is theirs now, not the model's
                setInferred((m) => ({ ...m, [f.key]: false }))
              }}
              placeholder={f.placeholder}
              className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        ))}
      </div>

      {/* Suggestions sit between the fields and the notes: they fill the fields
          above, and every one shows the quote that justifies it. A suggestion
          with no quote never reaches here — the server drops findings whose
          evidence does not literally appear in the post. */}
      <div className="mb-3">
        <button
          onClick={() => suggest.mutate()}
          disabled={suggest.isPending}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
        >
          {suggest.isPending ? <Spinner size={11} /> : <Sparkles size={11} />}
          {suggest.isPending ? 'Reading their posts…' : 'Suggest from their posts'}
        </button>
        <MutationError m={suggest} className="mt-1 text-xs" />

        {suggestions?.length === 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            They never say who they work for or what they do — which is the usual case. Nothing was
            invented to fill the gap.
          </p>
        )}

        {!!suggestions?.length && (
          <ul className="mt-2 space-y-2">
            {suggestions.map((s, i) => (
              <li
                key={`${s.field}-${i}`}
                className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-zinc-500">{s.field}</span>
                  <span className="font-medium">{s.value}</span>
                  <button
                    onClick={() => {
                      setForm((f) => ({ ...f, [s.field]: s.value }))
                      setInferred((m) => ({ ...m, [s.field]: true }))
                      setSuggestions((list) => (list ?? []).filter((_, j) => j !== i))
                    }}
                    className="ml-auto rounded-md border border-zinc-300 px-2 py-0.5 dark:border-zinc-700"
                  >
                    Use
                  </button>
                </div>
                <blockquote className="mt-1 flex gap-1.5 italic text-zinc-500">
                  <Quote size={11} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">{s.evidence}</span>
                </blockquote>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-zinc-400 underline underline-offset-2"
                  >
                    the post
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="mb-3 block text-sm">
        <span className="text-xs text-zinc-500">
          What they want, in your words — the thing you would say to open the conversation
        </span>
        <textarea
          value={form.intentSummary}
          onChange={(e) => setForm((s) => ({ ...s, intentSummary: e.target.value }))}
          rows={3}
          className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {save.isPending && <Spinner size={12} />}
          {save.isPending ? 'Saving…' : started ? 'Save profile' : 'Create profile'}
        </button>
        {!started && (
          <button
            onClick={() => setOpen(false)}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Cancel
          </button>
        )}
        {profile?.researchedAt && (
          <span className="text-xs text-zinc-500">
            last edited {new Date(profile.researchedAt).toLocaleDateString()}
            {profile.researchedBy?.username ? ` by ${profile.researchedBy.username}` : ''}
          </span>
        )}
      </div>
      <MutationError m={save} className="mt-2 text-xs" />
    </div>
  )
}
