/**
 * Classification criteria — the single source of truth.
 *
 * Lane definitions used to live as prose inside the model prompt, which meant
 * the rules could not be tuned, reused, or shown to anyone. They are now typed
 * data, consumed by:
 *   - the prompt (generated from `test` / `includes` / `excludes`)
 *   - server-side verification (`requiresEvidence`)
 *   - the UI badge and its tooltip (`label`, `badge`, `test`)
 *
 * Editing a rule here changes every one of those at once. Bump PROMPT_VERSION
 * in ai.ts when you do — stored rows record the version that produced them, so
 * a criteria change stays traceable.
 */

export type Lane = 'respond' | 'lead' | 'monitor';
export type Quality = 'normal' | 'suspected-spam';

export type LaneCriteria = {
  id: Lane;
  /** shown on the badge and in the queue filter */
  label: string;
  /** the ONE test, stated so a human and a model apply the same rule */
  test: string;
  includes: string[];
  excludes: string[];
  /**
   * When true, the model must quote the author's own words and the quote is
   * verified against the mention text before the lane is accepted. Inferred
   * intent cannot survive that check — which is the whole point, since
   * "signals potential dissatisfaction" was how frustration became a lead.
   */
  requiresEvidence: boolean;
  /** null = not badged (respond is the default view; badging it is noise) */
  badge: string | null;
};

export const LANES: LaneCriteria[] = [
  {
    id: 'respond',
    label: 'reply work',
    test: 'A human should reply to this — it names Strapi, or asks something we can answer.',
    includes: ['a question about Strapi', 'a bug report', 'praise or criticism naming Strapi'],
    excludes: ['competitor discourse that never names us'],
    requiresEvidence: false,
    badge: null,
  },
  {
    id: 'lead',
    label: 'lead',
    test:
      'The author is choosing, trying, or moving — a decision about their own stack that is open, ' +
      'in progress, or actively being explored. Most leads never mention Strapi at all; that is ' +
      'expected and must not count against them. When it is genuinely borderline, prefer lead: a ' +
      'missed lead costs a real opportunity, a false one costs one read.',
    includes: [
      '"looking for a headless CMS"',
      '"thinking about switching to X"',
      '"we are moving off X"',
      '"started exploring X"',
      '"which CMS should I use?"',
      '"evaluating X for an upcoming project"',
      '"testing X to decide"',
      'asking about migration effort or hosting cost for a tool they are considering',
    ],
    excludes: [
      '"we rebuilt it in Next.js last year" — finished; there is no decision left to influence',
      '"Webflow pricing is outrageous" — a complaint ALONE, with no trying, choosing or moving',
      '"no-code is a dead end" — an opinion about the market, not about their own stack',
      '"OpenAI is closing the gap" — third-party news',
      'a vendor or bot promoting a product',
    ],
    requiresEvidence: true,
    badge: 'lead',
  },
  {
    id: 'monitor',
    label: 'monitor',
    test: 'Real signal, but nobody needs to reply: commentary, opinion, news reaction, ads, bot feeds.',
    includes: ['industry commentary', 'a completed migration retrospective', 'product launch news'],
    excludes: ['anything with an open decision — that is a lead'],
    requiresEvidence: false,
    badge: 'monitor',
  },
];

export const laneById = (id: string) => LANES.find((l) => l.id === id);

/** The lane section of the system prompt, generated so prose and behaviour
 *  cannot drift apart. */
export function laneRubric(): string {
  return LANES.map((l) => {
    const inc = l.includes.map((x) => `      IN  : ${x}`).join('\n');
    const exc = l.excludes.map((x) => `      OUT : ${x}`).join('\n');
    const ev = l.requiresEvidence
      ? '\n      You MUST quote the author\'s own words in laneEvidence, verbatim. No quote, no lead.'
      : '';
    return `  "${l.id}" — ${l.test}\n${inc}\n${exc}${ev}`;
  }).join('\n\n');
}

/**
 * Spam criteria, same treatment. `spam` is deliberately not a value the model
 * can produce: it hides a mention from the queue AND every metric, so
 * confirming it stays a human decision.
 */
export const QUALITY_RUBRIC = [
  '"suspected-spam" — promotional content, AI-generated filler, engagement bait,',
  '  automated bot feeds, or the same template posted across unrelated threads.',
  '"normal" — everything else, including blunt criticism and low-effort posts.',
  'Never confirm outright spam; a human does that.',
].join('\n');
