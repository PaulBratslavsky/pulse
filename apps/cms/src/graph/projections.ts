import type { Core } from '@strapi/strapi';
import type { GraphArgs, GraphEdge, GraphNode, GraphProjection, GraphTopology } from './types';
import { pruneByDocumentFrequency, termsOf } from './text';

/**
 * Graph projections — the extensibility seam.
 *
 * Adding a way to look at the corpus means adding one descriptor to
 * GRAPH_PROJECTIONS below. The REST route, the MCP tool, the clustering pass
 * and the renderer are all generic over the wire format, so none of them
 * change. Same shape as PULSE_TOOLS in src/tools/registry.ts.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * Spam and our own posts are excluded here exactly as they are from the
 * metrics — a content farm posting the same template 27 times would otherwise
 * dominate the map with a dense fake cluster. Mirrors NOT_SPAM in
 * api/analysis/services/insights.ts; kept in sync deliberately.
 */
const SPAM_QUALITIES = ['spam', 'suspected-spam'];
const NOT_SPAM = {
  $and: [
    { $or: [{ quality: { $null: true } }, { quality: { $notIn: SPAM_QUALITIES } }] },
    { $or: [{ acknowledgeReason: { $null: true } }, { acknowledgeReason: { $ne: 'own-post' } }] },
  ],
} as any;

async function loadMentions(strapi: Core.Strapi, days: number) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  return (await strapi.documents('api::mention.mention').findMany({
    filters: { ...NOT_SPAM, postedAt: { $gte: since } } as any,
    fields: ['content', 'sentimentScore', 'sentimentLabel', 'authorHandle', 'postedAt'],
    populate: { topics: { fields: ['name', 'slug', 'kind'] } } as any,
    limit: 5000,
  })) as any[];
}

/** Undirected pair key, order-independent. The separator must be a character
 *  the tokenizer can never emit: bigram terms contain spaces, so joining on
 *  " " would make "content type"+"api" indistinguishable from
 *  "content"+"type api" when the key is split back apart. */
const SEP = '\u0000';
const pairKey = (a: string, b: string) => (a < b ? `${a}${SEP}${b}` : `${b}${SEP}${a}`);

/**
 * Builds nodes + edges from per-document term lists. Shared by the projections
 * so co-occurrence semantics (and the edge pruning that keeps the graph
 * readable) are defined once.
 */
function coOccurrence(
  docs: { terms: string[]; sentiment: number | null }[],
  args: GraphArgs,
  kind: string,
  labelOf: (id: string) => string = (id) => id
): GraphTopology {
  const nodeStat = new Map<string, { df: number; sentSum: number; sentN: number }>();
  const edgeWeight = new Map<string, number>();

  for (const doc of docs) {
    for (const t of doc.terms) {
      const s = nodeStat.get(t) ?? { df: 0, sentSum: 0, sentN: 0 };
      s.df += 1;
      if (doc.sentiment != null) {
        s.sentSum += doc.sentiment;
        s.sentN += 1;
      }
      nodeStat.set(t, s);
    }
    // every unordered pair within the document
    const uniq = [...new Set(doc.terms)];
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++) {
        const k = pairKey(uniq[i], uniq[j]);
        edgeWeight.set(k, (edgeWeight.get(k) ?? 0) + 1);
      }
  }

  // Cap by weight, loudly. A silent top-N would read as "this is the whole
  // conversation" when it isn't.
  const ranked = [...nodeStat.entries()].sort((a, b) => b[1].df - a[1].df);
  const truncated = ranked.length > args.maxNodes;
  const kept = new Set(ranked.slice(0, args.maxNodes).map(([id]) => id));

  const nodes: GraphNode[] = ranked
    .filter(([id]) => kept.has(id))
    .map(([id, s]) => ({
      id,
      kind,
      label: labelOf(id),
      weight: s.df,
      meta: { avgSentiment: s.sentN ? Math.round((s.sentSum / s.sentN) * 100) / 100 : null },
    }));

  const candidates: GraphEdge[] = [];
  for (const [k, w] of edgeWeight) {
    if (w < args.minWeight) continue;
    const [a, b] = k.split(SEP);
    if (!kept.has(a) || !kept.has(b)) continue;
    candidates.push({ source: a, target: b, weight: w, kind: 'co-occurrence' });
  }
  // Keep only the heaviest edges. Unbounded co-occurrence over 300 concepts is
  // effectively a complete graph — 31,771 edges measured on the dev corpus,
  // which renders as a solid disc and collapses Louvain into one meaningless
  // community. Reported through `truncated`, never silently.
  const edgesTruncated = candidates.length > args.maxEdges;
  const edges = candidates.sort((a, b) => b.weight - a.weight).slice(0, args.maxEdges);

  // Isolated nodes make the layout drift and carry no relational information.
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.source);
    connected.add(e.target);
  }

  return {
    nodes: nodes.filter((n) => connected.has(n.id)),
    edges,
    mentionsConsidered: docs.length,
    truncated: truncated || edgesTruncated,
  };
}

/**
 * TERMS — the projection that actually has data today. Concepts are mined from
 * mention text, so it does not depend on the AI sweep having run.
 */
const termsProjection: GraphProjection = {
  id: 'terms',
  label: 'Concepts',
  description:
    'Concepts mined from mention text, linked when they appear in the same mention. Works without ' +
    'AI topic assignment, so this is the dense view of what the community actually discusses.',
  build: async (strapi, args) => {
    const mentions = await loadMentions(strapi, args.days);
    const raw = mentions.map((m) => ({
      terms: termsOf(m.content),
      sentiment: m.sentimentScore == null ? null : Number(m.sentimentScore),
    }));
    // DF thresholds scale with corpus size: a fixed floor is too strict on a
    // small window and too loose on a large one.
    const minDf = Math.max(3, Math.round(raw.length * 0.004));
    const keep = pruneByDocumentFrequency(
      raw.map((d) => d.terms),
      { minDf, maxDfRatio: 0.4 }
    );
    const docs = raw
      .map((d) => ({ ...d, terms: d.terms.filter((t) => keep.has(t)) }))
      .filter((d) => d.terms.length > 1);
    return coOccurrence(docs, args, 'term');
  },
};

/**
 * TOPICS — curated Topic entities. Sparse until the AI sweep runs (today only
 * 7 mentions carry more than one topic, and a co-occurrence edge needs two),
 * but correct by construction and it gets good for free once topics populate.
 */
const topicsProjection: GraphProjection = {
  id: 'topics',
  label: 'Topics',
  description:
    'Curated Topic entities linked when they are attached to the same mention. Sparse until AI topic ' +
    'assignment is enabled — prefer the "terms" projection for a dense picture.',
  build: async (strapi, args) => {
    const mentions = await loadMentions(strapi, args.days);
    const nameBySlug = new Map<string, string>();
    const docs = mentions.map((m) => {
      for (const t of m.topics ?? []) nameBySlug.set(t.slug, t.name);
      return {
        terms: (m.topics ?? []).map((t: any) => t.slug),
        sentiment: m.sentimentScore == null ? null : Number(m.sentimentScore),
      };
    });
    return coOccurrence(docs, args, 'topic', (slug) => nameBySlug.get(slug) ?? slug);
  },
};

/**
 * AUTHORS — who is shaped by which concerns. Bipartite author↔concept rather
 * than author↔author: two people sharing a word is weak evidence of anything,
 * whereas the bipartite form shows directly which voices span clusters.
 */
const authorsProjection: GraphProjection = {
  id: 'authors',
  label: 'Voices',
  description:
    'Authors linked to the concepts they raise. Shows who forms the conversation and which voices ' +
    'span otherwise separate clusters — useful for outreach targeting.',
  build: async (strapi, args) => {
    const mentions = await loadMentions(strapi, args.days);
    const raw = mentions.map((m) => ({
      author: String(m.authorHandle ?? '').trim(),
      terms: termsOf(m.content),
      sentiment: m.sentimentScore == null ? null : Number(m.sentimentScore),
    }));
    const minDf = Math.max(3, Math.round(raw.length * 0.004));
    const keep = pruneByDocumentFrequency(
      raw.map((d) => d.terms),
      { minDf, maxDfRatio: 0.4 }
    );

    const nodeStat = new Map<string, { kind: string; weight: number; sentSum: number; sentN: number }>();
    const edgeWeight = new Map<string, number>();
    const bump = (id: string, kind: string, sentiment: number | null) => {
      const s = nodeStat.get(id) ?? { kind, weight: 0, sentSum: 0, sentN: 0 };
      s.weight += 1;
      if (sentiment != null) {
        s.sentSum += sentiment;
        s.sentN += 1;
      }
      nodeStat.set(id, s);
    };

    for (const d of raw) {
      if (!d.author) continue;
      const terms = [...new Set(d.terms.filter((t) => keep.has(t)))];
      if (!terms.length) continue;
      const authorId = `@${d.author}`;
      bump(authorId, 'author', d.sentiment);
      for (const t of terms) {
        bump(t, 'term', d.sentiment);
        const k = pairKey(authorId, t);
        edgeWeight.set(k, (edgeWeight.get(k) ?? 0) + 1);
      }
    }

    // Cap each SIDE independently. A single global top-N is ranked by weight,
    // and concept frequencies dwarf per-author counts — every author fell
    // outside the cap, so almost no author↔concept edge survived (measured: 4
    // nodes). Half the budget to each side keeps the bipartite graph bipartite.
    const ranked = [...nodeStat.entries()].sort((a, b) => b[1].weight - a[1].weight);
    const half = Math.max(5, Math.floor(args.maxNodes / 2));
    const topOf = (kind: string) =>
      ranked.filter(([, s]) => s.kind === kind).slice(0, half).map(([id]) => id);
    const kept = new Set([...topOf('author'), ...topOf('term')]);
    const truncated = ranked.length > kept.size;

    const edges: GraphEdge[] = [];
    for (const [k, w] of edgeWeight) {
      // no minWeight here: this edge is bipartite, and an author normally
      // raises a given concept once — filtering by weight emptied the graph
      const [a, b] = k.split(SEP);
      if (kept.has(a) && kept.has(b)) edges.push({ source: a, target: b, weight: w, kind: 'raised' });
    }
    edges.sort((x, y) => y.weight - x.weight);
    const edgesTruncated = edges.length > args.maxEdges;
    edges.splice(args.maxEdges);
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }

    const nodes: GraphNode[] = ranked
      .filter(([id]) => kept.has(id) && connected.has(id))
      .map(([id, s]) => ({
        id,
        kind: s.kind,
        label: id,
        weight: s.weight,
        meta: { avgSentiment: s.sentN ? Math.round((s.sentSum / s.sentN) * 100) / 100 : null },
      }));

    return { nodes, edges, mentionsConsidered: raw.length, truncated: truncated || edgesTruncated };
  },
};

export const GRAPH_PROJECTIONS: GraphProjection[] = [
  termsProjection,
  topicsProjection,
  authorsProjection,
];

export const getProjection = (id?: string) =>
  GRAPH_PROJECTIONS.find((p) => p.id === id) ?? GRAPH_PROJECTIONS[0];
