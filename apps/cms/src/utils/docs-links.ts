/**
 * Real Strapi documentation URLs, from the sitemap.
 *
 * A drafted reply once shipped four links, three of which 404'd:
 *
 *   https://docs.strapi.io/dev-docs/rest-api                     → 404
 *   https://docs.strapi.io/dev-docs/backend-customization/plugins → 404
 *
 * They are not typos — `/dev-docs/` is the **v4** URL scheme, and the model was
 * reproducing paths from its training data. v5 moved everything under `/cms/`.
 * The prompt made it worse by asking the model to "cite specific pages you are
 * confident exist", which is an invitation to guess.
 *
 * The fix is to stop letting a model author URLs at all. docs.strapi.io
 * publishes a sitemap — 328 real pages, no auth, no API key — so the set of
 * valid links is knowable exactly. We hand the model a shortlist and then throw
 * away any link in its output that is not on the list.
 *
 * This is deliberately independent of the docs MCP. MCP grounding improves what
 * the reply SAYS; it cannot guarantee the model transcribes a URL correctly, and
 * it is OAuth-gated so it can be unavailable. Link correctness should not depend
 * on a network call succeeding.
 */

const SITEMAP = 'https://docs.strapi.io/sitemap.xml';
const TTL_MS = 6 * 60 * 60 * 1000; // docs ship often, but not hourly

let cache: { urls: string[]; at: number } | null = null;
let inflight: Promise<string[]> | null = null;

/** Trailing slashes and anchors are noise when comparing two doc URLs. */
export const canonical = (url: string): string =>
  url.trim().replace(/[).,;:]+$/, '').split('#')[0].replace(/\/+$/, '').toLowerCase();

async function fetchSitemap(): Promise<string[]> {
  const res = await fetch(SITEMAP, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`sitemap ${res.status}`);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith('https://docs.strapi.io/'));
  if (!urls.length) throw new Error('sitemap parsed to zero urls');
  return urls;
}

/**
 * The URL list, cached. On a fetch failure we keep serving a stale list rather
 * than an empty one — stale-but-real beats no links, and an empty list would
 * silently strip every citation from a draft.
 */
export async function docsUrls(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.urls;
  if (inflight) return inflight;
  inflight = fetchSitemap()
    .then((urls) => {
      cache = { urls, at: Date.now() };
      return urls;
    })
    .catch((err) => {
      if (cache) return cache.urls;
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function isRealDocsUrl(url: string): Promise<boolean> {
  const set = new Set((await docsUrls()).map(canonical));
  return set.has(canonical(url));
}

/** words worth matching on; short ones match everything and rank nothing */
const stop = new Set([
  'the','and','for','with','from','that','this','have','has','are','was','you','your','our',
  'how','what','when','why','can','use','using','into','about','strapi','docs','doc','a','an',
  'i','to','of','in','on','it','is','my','me','we','do','does','get','new','all','any','not',
]);

const terms = (text: string): string[] =>
  [...new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])].filter((t) => !stop.has(t));

/**
 * Rank the real URLs against the mention text by path-segment overlap.
 *
 * Crude on purpose: it only has to put a handful of plausible, REAL pages in
 * front of the model. Precision comes from the validation step afterwards —
 * a bad suggestion costs a slightly-off link, never a broken one.
 */
export async function shortlistDocsUrls(text: string, limit = 12): Promise<string[]> {
  const urls = await docsUrls();
  const want = terms(text);
  if (!want.length) return [];
  const scored = urls.map((u) => {
    const path = u.replace('https://docs.strapi.io/', '').toLowerCase();
    const segs = path.split(/[/-]/).filter(Boolean);
    let score = 0;
    for (const t of want) {
      if (segs.includes(t)) score += 3;
      else if (path.includes(t)) score += 1;
    }
    // prefer the v5 CMS docs over cloud/snippets when scores tie
    if (path.startsWith('cms/')) score += 0.5;
    if (path.startsWith('snippets/')) score -= 2;
    return { u, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.u);
}

export type LinkAudit = {
  text: string;
  removed: string[];
  kept: string[];
};

/**
 * Remove every docs.strapi.io URL in `text` that is not a real page.
 *
 * Markdown links become plain label text rather than vanishing, so the sentence
 * still reads; bare URLs are dropped. Non-docs links are left alone — this
 * module only claims authority over docs.strapi.io.
 */
export async function stripDeadDocsLinks(text: string): Promise<LinkAudit> {
  let urls: string[];
  try {
    urls = await docsUrls();
  } catch {
    // Cannot verify → do not silently mangle the draft. Say so upstream.
    return { text, removed: [], kept: [] };
  }
  const valid = new Set(urls.map(canonical));
  const removed: string[] = [];
  const kept: string[] = [];

  const check = (raw: string) => {
    const ok = valid.has(canonical(raw));
    (ok ? kept : removed).push(raw);
    return ok;
  };

  // [label](url) first, so the label survives a dead target
  let out = text.replace(
    /\[([^\]]+)\]\((https?:\/\/docs\.strapi\.io\/[^)\s]+)\)/g,
    (whole, label: string, url: string) => (check(url) ? whole : label)
  );

  out = out.replace(/https?:\/\/docs\.strapi\.io\/[^\s)<>\]]*/g, (url: string) =>
    check(url) ? url : ''
  );

  // tidy the punctuation a removed bare URL leaves behind
  out = out.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
  return { text: out, removed, kept };
}

/** Filter a set of candidate URLs down to the ones that really exist. */
export async function keepRealDocsUrls(urls: string[]): Promise<string[]> {
  const valid = new Set((await docsUrls()).map(canonical));
  return [...new Set(urls.filter((u) => valid.has(canonical(u))))];
}
