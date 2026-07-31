/**
 * Which lane a mention belongs in — the routing decision Pulse was missing.
 *
 * The problem it solves: 198 of 393 real mentions name Webflow, 58 name
 * Strapi, and ZERO name both. Everything landed in one reply queue regardless,
 * so a queue meant for human replies was ~80% competitor discourse.
 *
 * The instinct is a keyword allowlist at ingest. Measured against the real
 * corpus, `strapi|webflow|headless cms` keeps 256 of 393 and leaves the queue
 * just as Webflow-heavy, while permanently discarding 137 rows — including
 * competitor-evaluation threads that name none of those words. Filtering is
 * lossy, unauditable, and aimed at the wrong problem.
 *
 * So: route, never drop. Nothing is discarded; `monitor` items keep full data
 * and stay in trends and theme reports, they just don't occupy the reply queue.
 *
 * The signal is authoritative rather than guessed: Octolens sends the search
 * term that fired, already tagged own_brand / competitor / industry_term
 * (present on 374 of 437 rows). Routing on that beats re-deriving intent by
 * scanning body text after the fact.
 */

export type Lane = 'respond' | 'lead' | 'monitor';

/**
 * Someone shopping, leaving, or comparing. Deliberately narrow: a false
 * `lead` costs a wasted read, and these surface ABOVE ordinary mentions.
 * Crude by design — an agent or the AI sweep refines the call later via
 * pulse-set-lane; this only has to be a defensible first pass with no API key.
 */
const SWITCHING = new RegExp(
  [
    'mov(e|ing) (away|off|from)',
    'migrat(e|ing|ion) (from|off|away)',
    'switch(ing|ed)? (from|to|away)',
    'alternative[s]? to',
    'replac(e|ing) (webflow|contentful|wordpress|sanity)',
    'leaving (webflow|contentful|wordpress)',
    'cancel(l?ing|led)? (my |our )?(webflow|contentful|subscription)',
    'too expensive',
    'price (increase|hike)',
    'looking for a (headless )?cms',
    'which (headless )?cms',
    'recommend a (headless )?cms',
    'evaluat(e|ing) (a )?cms',
  ].join('|'),
  'i'
);

export type KeywordHit = { keyword?: string; keywordTag?: string };

/** Strongest signal wins: our own brand beats a competitor term on the same post. */
export function strongestTag(keywords: KeywordHit[]): string | null {
  const tags = new Set(keywords.map((k) => k.keywordTag).filter(Boolean) as string[]);
  if (tags.has('own_brand')) return 'own_brand';
  if (tags.has('industry_term')) return 'industry_term';
  if (tags.has('competitor')) return 'competitor';
  return [...tags][0] ?? null;
}

export function extractKeywords(raw: any): KeywordHit[] {
  const list = raw?.keywords;
  return Array.isArray(list)
    ? list.map((k: any) => ({ keyword: k?.keyword, keywordTag: k?.keywordTag }))
    : [];
}

/**
 * Returns the lane plus the one-line reason that produced it. The reason is
 * the point: when the routing is wrong you can see WHICH rule fired and fix
 * that rule, instead of guessing — same contract as qualityReason.
 */
export function classify(input: { content?: string; keywords?: KeywordHit[] }): {
  lane: Lane;
  laneReason: string;
} {
  const content = String(input.content ?? '');
  const keywords = input.keywords ?? [];
  const tag = strongestTag(keywords);
  const namesStrapi = /\bstrapi\b/i.test(content);

  // Anything naming us is reply work, regardless of what else it names.
  if (namesStrapi) return { lane: 'respond', laneReason: 'body mentions Strapi' };
  if (tag === 'own_brand')
    return { lane: 'respond', laneReason: 'Octolens matched an own-brand term' };

  // Someone actively shopping or leaving a competitor is the highest-value
  // thing in the corpus and frequently names no Strapi keyword at all.
  if (SWITCHING.test(content)) {
    const via = tag ? `${tag} term + ` : '';
    return { lane: 'lead', laneReason: `${via}switching or evaluation intent in the body` };
  }

  if (tag === 'competitor')
    return { lane: 'monitor', laneReason: 'competitor term only, no switching intent' };
  if (tag === 'industry_term')
    return { lane: 'monitor', laneReason: 'industry term only, no switching intent' };

  // No keyword payload and nothing matched: keep it in the queue rather than
  // hiding it. When in doubt, a human sees it — the failure mode of the other
  // default is a thread that silently never surfaces.
  return { lane: 'respond', laneReason: 'unclassified — defaulting to the reply queue' };
}
