/**
 * Author identity — pure functions, no Strapi, no I/O.
 *
 * A `Person` needs a stable key, and the handle is the wrong one. Octolens
 * sends a *display name* in `author` on LinkedIn ("Digi Hotshot® - Webflow
 * Premium Partner"), case varies between platforms, and the same human is
 * `@codingafterthirty` on Reddit and `@codingthirty` on X. One handle
 * collision already exists in the corpus.
 *
 * The profile URL is the strong key: it is platform-scoped by construction and
 * present on 431 of 433 real mentions. Everything below is written against the
 * hosts actually observed in that corpus:
 *
 *     172 twitter.com  ·  162 www.reddit.com  ·  58 dev.to  ·  18 www.linkedin.com
 *      16 bsky.app     ·  2 www.youtube.com   ·  1 each tiktok / HN / podcast hosts
 */

/** Hosts where a bare profile URL identifies a person. */
const PROFILE_HOSTS = new Set([
  'x.com',
  'reddit.com',
  'dev.to',
  'linkedin.com',
  'bsky.app',
  'youtube.com',
  'tiktok.com',
  'news.ycombinator.com',
]);

/**
 * Normalize the host. `twitter.com` and `x.com` are the same site and Octolens
 * still emits the old one — left alone, the same person splits in two the day
 * that changes. LinkedIn country subdomains (`de.linkedin.com/in/x`) are the
 * same profile as the canonical one.
 */
function normalizeHost(host: string): string {
  let h = host.toLowerCase().replace(/^www\./, '');
  if (h === 'twitter.com' || h === 'mobile.twitter.com') h = 'x.com';
  if (h.endsWith('.linkedin.com')) h = 'linkedin.com';
  return h;
}

export type Identity = {
  /** stable, lowercase, platform-scoped — unique key on `person` */
  key: string;
  /**
   * True when the key came from the handle rather than a profile URL. Such a
   * person can be absorbed by a later merge without losing anything; a
   * URL-keyed one is authoritative.
   */
  provisional: boolean;
};

/**
 * Build the identity key for an author.
 *
 * Returns a URL-derived key when the URL points at a *profile*, and falls back
 * to `channel:handle` otherwise. The fallback is not a failure mode — it is
 * correct for the 2 rows with no URL, and for the podcast/agency homepages in
 * the corpus (`noco.agency/`, `shows.acast.com/well-spaced`), which are sites
 * rather than people and must not be treated as authoritative identities.
 */
export function identityKeyOf(input: {
  authorProfileUrl?: string | null;
  authorHandle?: string | null;
  channelKey?: string | null;
}): Identity | null {
  const url = (input.authorProfileUrl ?? '').trim();
  const parsed = url ? parseProfile(url) : null;
  if (parsed) return { key: parsed, provisional: false };

  const handle = (input.authorHandle ?? '').trim().replace(/^@+/, '').toLowerCase();
  if (!handle) return null;
  const channel = (input.channelKey ?? 'unknown').trim().toLowerCase();
  return { key: `${channel}:${handle}`, provisional: true };
}

function parseProfile(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.includes('://') ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = normalizeHost(u.hostname);
  if (!PROFILE_HOSTS.has(host)) return null;

  const path = u.pathname.replace(/\/+$/, '').toLowerCase();

  // Hacker News keeps identity in the query string, not the path — the one
  // place where dropping the query would erase the person entirely.
  if (host === 'news.ycombinator.com') {
    const id = u.searchParams.get('id');
    return id ? `${host}/user?id=${id.toLowerCase()}` : null;
  }

  // A bare host with no path is a site, not a profile.
  if (!path) return null;

  return `${host}${path}`;
}

/**
 * Was this an original post or a reply?
 *
 * Derived from the permalink because the payload never says. All 162 Reddit
 * rows in the corpus are comments — a fact worth knowing before treating
 * "posted about us" and "replied in a thread" as the same signal.
 *
 * `unknown` is a real answer and must never score or penalize.
 */
export function postKindOf(url?: string | null): 'original' | 'reply' | 'unknown' {
  if (!url) return 'unknown';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'unknown';
  }
  const host = normalizeHost(u.hostname);
  const seg = u.pathname.split('/').filter(Boolean);

  if (host === 'reddit.com') {
    // /r/<sub>/comments/<id>/<slug>            → the post itself
    // /r/<sub>/comments/<id>/<slug>/<comment>  → a comment on it
    const i = seg.indexOf('comments');
    if (i === -1) return 'unknown';
    return seg.length > i + 3 ? 'reply' : 'original';
  }
  if (host === 'x.com') return seg.includes('status') ? 'original' : 'unknown';
  if (host === 'dev.to') return seg.length >= 2 ? 'original' : 'unknown';
  if (host === 'bsky.app') return seg.includes('post') ? 'original' : 'unknown';
  return 'unknown';
}

/**
 * Where the conversation happened — currently the subreddit.
 *
 * r/PayloadCMS and r/Wordpress are a genuine technographic hint about the
 * author's stack, and it is the only such hint the payload contains.
 */
export function venueOf(url?: string | null): string | null {
  if (!url) return null;
  const m = /^https?:\/\/(?:[a-z0-9-]+\.)?reddit\.com\/r\/([A-Za-z0-9_]+)/i.exec(url);
  return m ? `r/${m[1]}` : null;
}

/**
 * Which conversation a mention belongs to, derived from its permalink.
 *
 * Octolens sends no parent, thread or conversation field — checked across the
 * corpus — so the only way to know that six posts are one exchange is to read
 * it out of the URL, the same way venueOf and identityKeyOf already do.
 *
 * Reddit only, deliberately. A Reddit permalink names the submission every
 * comment hangs off (`/r/sub/comments/<postId>/<slug>/<commentId>`), so the
 * grouping is exact. An X reply URL is `/user/status/<the reply's own id>` and
 * carries nothing about what it replies to, so threading it from the URL would
 * be guesswork — better to return null and leave those mentions ungrouped than
 * to invent a conversation that might not exist.
 *
 * In the corpus this covers 218 mentions across 115 threads, 39 of which hold
 * more than one mention.
 */
export function threadKeyOf(url?: string | null): string | null {
  if (!url) return null;
  const m = /^https?:\/\/(?:[a-z0-9-]+\.)?reddit\.com\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)/i.exec(
    url
  );
  return m ? `reddit:${m[1].toLowerCase()}/${m[2].toLowerCase()}` : null;
}
