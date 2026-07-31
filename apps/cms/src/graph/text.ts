/**
 * Term extraction for the graph projections.
 *
 * Deliberately dependency-free and NOT AI: the graph has to work with
 * `AI_API_KEY` unset, which is the current production posture. It also has to
 * work on the corpus as it actually is — 687 of 1005 mentions carry no Topic
 * at all, so a graph built from the `Topic` relation would be a blank canvas.
 * Terms come from the mention text instead (the InfraNodus model: concepts as
 * nodes, co-occurrence as edges).
 */

/** Terms every Strapi mention contains — they'd be mega-hubs joined to
 *  everything, which tells you nothing. The DF ceiling below would catch most
 *  of these anyway; naming them is cheaper and survives corpus growth. */
const DOMAIN_STOPWORDS = new Set([
  'strapi', 'strapis', 'cms', 'headless', 'headlesscms',
]);

/** Standard English function words. Kept inline rather than pulling a package:
 *  it is a static list, and the repo's convention is to avoid dependencies for
 *  things that don't change. */
const STOPWORDS = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are','arent','as','at',
  'be','because','been','before','being','below','between','both','but','by','cant','cannot','could',
  'couldnt','did','didnt','do','does','doesnt','doing','dont','down','during','each','few','for','from',
  'further','had','hadnt','has','hasnt','have','havent','having','he','hed','hes','her','here','heres',
  'hers','herself','him','himself','his','how','hows','i','id','ill','im','ive','if','in','into','is',
  'isnt','it','its','itself','lets','me','more','most','mustnt','my','myself','no','nor','not','of',
  'off','on','once','only','or','other','ought','our','ours','ourselves','out','over','own','same',
  'shant','she','shed','shes','should','shouldnt','so','some','such','than','that','thats','the','their',
  'theirs','them','themselves','then','there','theres','these','they','theyd','theyll','theyre','theyve',
  'this','those','through','to','too','under','until','up','very','was','wasnt','we','wed','well','were',
  'werent','weve','what','whats','when','whens','where','wheres','which','while','who','whos','whom',
  'why','whys','with','wont','would','wouldnt','you','youd','youll','youre','youve','your','yours',
  'yourself','yourselves',
  // conversational filler that survives the list above and adds no signal
  'just','like','get','got','use','using','used','make','makes','made','need','needs','really','also',
  'even','still','much','many','way','ways','thing','things','lot','lots','one','two','see','know',
  'think','want','going','go','goes','new','good','great','best','better','well','now','time','people',
  'can','will','dont','doesnt','isnt','im','ive','id','youre','theyre','thats','whats','heres','theres',
]);

const isStop = (w: string) => STOPWORDS.has(w) || DOMAIN_STOPWORDS.has(w);

/**
 * Normalise a mention body into candidate unigrams.
 * URLs and @handles are stripped rather than tokenised — a tracking URL would
 * otherwise contribute a dozen junk terms that co-occur perfectly with each
 * other and form a fake cluster.
 */
export function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\w-]+/g, ' ')
    .replace(/[`*_~>[\]()|]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[''-]+|[''-]+$/g, ''))
    .filter((w) => w.length >= 3 && w.length <= 32 && !/^\d+$/.test(w));
}

/**
 * Unigrams plus adjacent bigrams. Bigrams matter because the interesting
 * concepts here are compounds — "content type", "api token", "draft publish" —
 * and as separate unigrams they'd scatter into unrelated clusters.
 * A bigram is only formed across two non-stopwords, so "one of the" never
 * becomes a term.
 */
export function termsOf(text: string): string[] {
  const words = tokenize(text);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!isStop(w)) out.add(w);
    const next = words[i + 1];
    if (next && !isStop(w) && !isStop(next)) out.add(`${w} ${next}`);
  }
  return [...out];
}

/**
 * Document-frequency pruning — the single knob that decides whether the graph
 * is readable or a hairball.
 *  - `minDf` drops one-off noise (typos, a single ranty post's vocabulary).
 *  - `maxDfRatio` drops terms so common they carry no information; they'd
 *    connect to everything and collapse the layout into a single blob.
 */
export function pruneByDocumentFrequency(
  docs: string[][],
  opts: { minDf: number; maxDfRatio: number }
): Set<string> {
  const df = new Map<string, number>();
  for (const terms of docs) for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);

  const ceiling = Math.max(opts.minDf, Math.floor(docs.length * opts.maxDfRatio));
  const keep = new Set<string>();
  for (const [term, n] of df) if (n >= opts.minDf && n <= ceiling) keep.add(term);

  // A bigram whose two halves both survive is strictly more informative than
  // either half at the same frequency; drop the halves only when the bigram
  // fully explains them, so "content type" doesn't sit next to a redundant
  // "content" of identical weight.
  for (const [term, n] of df) {
    if (!term.includes(' ') || !keep.has(term)) continue;
    for (const half of term.split(' ')) if (df.get(half) === n) keep.delete(half);
  }
  return keep;
}
