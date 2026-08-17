/**
 * Why a mention was closed without a public reply.
 *
 * One list, three surfaces: the detail page's radios, the bulk-edit select, and
 * the per-card quick menu. It was written out twice before this and the wording
 * had already drifted — "deleted" in one place, "deleted from the platform" in
 * the other — which matters because the value is what lands on the activity
 * trail and in reports.
 *
 * `hint` is the parenthetical the detail page shows when there is room to
 * explain; compact surfaces show `label` alone.
 */
export const ACK_REASONS = [
  { value: 'competitor', label: 'competitor', hint: 'replying would look pushy' },
  { value: 'not-relevant', label: 'not relevant', hint: '' },
  { value: 'watching', label: 'watching', hint: 'no reply needed yet' },
  { value: 'deleted', label: 'deleted', hint: 'the post is gone from the platform' },
  { value: 'own-post', label: 'our own post', hint: 'kept out of sentiment metrics' },
] as const

export type TAckReason = (typeof ACK_REASONS)[number]['value']

/** "competitor (replying would look pushy)" — for surfaces with room. */
export const ackLabelWithHint = (r: (typeof ACK_REASONS)[number]) =>
  r.hint ? `${r.label} (${r.hint})` : r.label
