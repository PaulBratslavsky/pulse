export type Kind = 'comment' | 'note' | 'feedback'

/** note = the team's take (amber, Zendesk internal convention);
 *  feedback = the mention author responded / gave product insight (teal);
 *  comment = quick chat (plain). One flat stream, one collection. */
export const KIND_META: Record<
  Kind,
  { chip: string; active: string; badge: string | null; card: string; badgeClass: string; placeholder: string; submit: string }
> = {
  comment: {
    chip: 'Comment',
    active: 'border-zinc-900 font-medium dark:border-white',
    badge: null,
    badgeClass: '',
    card: 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900',
    placeholder: 'Quick comment…',
    submit: 'Comment',
  },
  note: {
    chip: 'Note (with resources)',
    active: 'border-amber-500 bg-amber-100 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    badge: 'note',
    badgeClass: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100',
    card: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20',
    placeholder: "The team's take, context, decisions…",
    submit: 'Add note',
  },
  feedback: {
    chip: 'Feedback',
    active: 'border-teal-500 bg-teal-100 font-medium text-teal-900 dark:bg-teal-900/40 dark:text-teal-200',
    badge: 'feedback',
    badgeClass: 'bg-teal-200 text-teal-900 dark:bg-teal-800 dark:text-teal-100',
    card: 'border-teal-300 bg-teal-50 dark:border-teal-700 dark:bg-teal-900/20',
    placeholder: 'What the author said back / product insight to capture…',
    submit: 'Add feedback',
  },
}

export const hostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
