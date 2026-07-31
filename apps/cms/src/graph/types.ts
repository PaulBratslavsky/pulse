import type { Core } from '@strapi/strapi';

/**
 * Wire format for every graph projection. The renderer, the REST endpoint and
 * the MCP tool are all generic over these types — a new projection needs no
 * change to any of them, which is the whole point of the registry.
 */

export type GraphNode = {
  id: string;
  /** drives colour/size in the renderer; add a kind, add a KIND_STYLE entry */
  kind: string;
  label: string;
  /** relative importance — document frequency for terms, mention count for topics */
  weight: number;
  /** cluster id, assigned server-side so every viewer sees the same grouping */
  cluster?: number;
  meta?: Record<string, unknown>;
};

export type GraphEdge = {
  source: string;
  target: string;
  /** co-occurrence count; the renderer maps it to thickness */
  weight: number;
  kind?: string;
};

export type GraphCluster = {
  id: number;
  /** highest-degree member — a discovered label, not a declared one */
  label: string;
  size: number;
  /** mean sentiment of the mentions behind this cluster, null when unscored */
  avgSentiment: number | null;
  terms: string[];
};

/** Pairs of clusters the corpus never connects. The most actionable output:
 *  two things the community talks about that nobody joins up is a piece of
 *  content that doesn't exist yet. */
export type StructuralGap = {
  a: string;
  b: string;
  aCluster: number;
  bCluster: number;
  /** how few edges bridge them — 0 means completely disjoint */
  bridges: number;
};

export type GraphPayload = {
  projection: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  /** highest-betweenness nodes: concepts that connect otherwise separate clusters */
  bridges: { id: string; label: string; score: number }[];
  gaps: StructuralGap[];
  stats: {
    windowDays: number;
    mentionsConsidered: number;
    nodeCount: number;
    edgeCount: number;
    /** true when the node cap trimmed the graph — never truncate silently */
    truncated: boolean;
  };
};

/** What `build` returns; the service stamps projection/generatedAt and runs the
 *  clustering + centrality pass, so a projection only has to produce topology. */
export type GraphTopology = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mentionsConsidered: number;
  truncated: boolean;
};

export type GraphProjection = {
  id: string;
  label: string;
  /** agent-facing: this is what pulse-graph shows an LLM choosing a projection */
  description: string;
  build: (strapi: Core.Strapi, args: GraphArgs) => Promise<GraphTopology>;
};

export type GraphArgs = {
  days: number;
  minWeight: number;
  maxNodes: number;
  /** Hard edge cap. 300 concept nodes co-occurring freely produce ~30k edges —
   *  a hairball that renders as a solid disc and clusters into mush. Keeping
   *  the heaviest edges preserves the structure that carries meaning. */
  maxEdges: number;
};
