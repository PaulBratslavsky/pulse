import type { Core } from '@strapi/strapi';
// named import: graphology ships no default export, so `import G from
// 'graphology'` compiles to undefined under esModuleInterop and only fails at
// `new G()` — long after the module loaded cleanly
import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import betweenness from 'graphology-metrics/centrality/betweenness';
import { getProjection, GRAPH_PROJECTIONS } from '../../../graph/projections';
import type { GraphArgs, GraphCluster, GraphPayload, StructuralGap } from '../../../graph/types';

/**
 * Graph service — one place that turns a projection's raw topology into an
 * analysed map. Consumed by the REST endpoint, the MCP tool and the frontend,
 * the same way api::analysis.insights backs trends/themes/snapshot.
 *
 * Clustering runs HERE rather than in the browser so every viewer sees the
 * same communities and a phone doesn't have to compute them. Layout stays on
 * the client, where it has to be interactive.
 */

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; payload: GraphPayload }>();

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const graph = ({ strapi }: { strapi: Core.Strapi }) => ({
  /** Projection catalogue — powers the UI switcher and the MCP tool's enum. */
  projections() {
    return GRAPH_PROJECTIONS.map((p) => ({ id: p.id, label: p.label, description: p.description }));
  },

  async build(opts: { projection?: string; days?: number; minWeight?: number; maxNodes?: number; maxEdges?: number } = {}) {
    const projection = getProjection(opts.projection);
    const args: GraphArgs = {
      days: clamp(Number(opts.days) || 90, 1, 365),
      minWeight: clamp(Number(opts.minWeight) || projection.defaultMinWeight, 1, 50),
      maxNodes: clamp(Number(opts.maxNodes) || 220, 10, 2000),
      maxEdges: clamp(Number(opts.maxEdges) || 1200, 50, 20000),
    };

    const key = `${projection.id}|${args.days}|${args.minWeight}|${args.maxNodes}|${args.maxEdges}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.payload;

    const topo = await projection.build(strapi, args);

    // graphology drives clustering + centrality. Nodes carry no edges when the
    // corpus is thin, so every step below must tolerate an empty graph.
    const g = new UndirectedGraph();
    for (const n of topo.nodes) g.addNode(n.id, { weight: n.weight });
    for (const e of topo.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      if (!g.hasEdge(e.source, e.target)) g.addEdge(e.source, e.target, { weight: e.weight });
    }

    const communities: Record<string, number> =
      g.order > 0 && g.size > 0 ? louvain(g, { getEdgeWeight: 'weight' }) : {};
    const central: Record<string, number> = g.order > 0 && g.size > 0 ? betweenness(g) : {};

    const nodes = topo.nodes.map((n) => ({ ...n, cluster: communities[n.id] ?? 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // Cluster label = highest-degree member. A discovered name beats a declared
    // one: it is whatever the conversation actually revolves around.
    const grouped = new Map<number, typeof nodes>();
    for (const n of nodes) {
      const arr = grouped.get(n.cluster!) ?? [];
      arr.push(n);
      grouped.set(n.cluster!, arr);
    }
    const clusters: GraphCluster[] = [...grouped.entries()]
      .map(([id, members]) => {
        const ranked = [...members].sort(
          (a, b) => (g.hasNode(b.id) ? g.degree(b.id) : 0) - (g.hasNode(a.id) ? g.degree(a.id) : 0)
        );
        const scored = members
          .map((m) => (m.meta?.avgSentiment as number | null) ?? null)
          .filter((s): s is number => s != null);
        return {
          id,
          label: ranked[0]?.label ?? `cluster ${id}`,
          size: members.length,
          avgSentiment: scored.length
            ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100) / 100
            : null,
          terms: ranked.slice(0, 8).map((m) => m.label),
        };
      })
      .sort((a, b) => b.size - a.size);

    const bridges = Object.entries(central)
      .map(([id, score]) => ({
        id,
        label: byId.get(id)?.label ?? id,
        score: Math.round(score * 1000) / 1000,
      }))
      .filter((b) => b.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return this.finish(projection.id, nodes, topo, clusters, bridges, args, g, key);
  },

  /**
   * Structural gaps: pairs of large clusters the corpus barely connects.
   * This is the most actionable output — two things the community discusses
   * that nobody joins up is a piece of content that does not exist yet.
   */
  gapsBetween(clusters: GraphCluster[], edges: { source: string; target: string }[], clusterOf: Map<string, number>) {
    const bridgeCount = new Map<string, number>();
    for (const e of edges) {
      const a = clusterOf.get(e.source);
      const b = clusterOf.get(e.target);
      if (a == null || b == null || a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      bridgeCount.set(k, (bridgeCount.get(k) ?? 0) + 1);
    }
    // only meaningful between clusters big enough to be real themes
    const significant = clusters.filter((c) => c.size >= 3).slice(0, 8);
    const gaps: StructuralGap[] = [];
    for (let i = 0; i < significant.length; i++)
      for (let j = i + 1; j < significant.length; j++) {
        const a = significant[i];
        const b = significant[j];
        const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        const bridges = bridgeCount.get(k) ?? 0;
        if (bridges <= 1) gaps.push({ a: a.label, b: b.label, aCluster: a.id, bCluster: b.id, bridges });
      }
    return gaps.sort((x, y) => x.bridges - y.bridges).slice(0, 6);
  },

  finish(
    projectionId: string,
    nodes: any[],
    topo: any,
    clusters: GraphCluster[],
    bridges: any[],
    args: GraphArgs,
    g: any,
    key: string
  ): GraphPayload {
    const clusterOf = new Map(nodes.map((n) => [n.id, n.cluster as number]));
    const payload: GraphPayload = {
      projection: projectionId,
      generatedAt: new Date().toISOString(),
      nodes,
      edges: topo.edges,
      clusters,
      bridges,
      gaps: this.gapsBetween(clusters, topo.edges, clusterOf),
      stats: {
        windowDays: args.days,
        mentionsConsidered: topo.mentionsConsidered,
        nodeCount: nodes.length,
        edgeCount: topo.edges.length,
        truncated: topo.truncated,
      },
    };
    cache.set(key, { at: Date.now(), payload });
    return payload;
  },

  /**
   * Agent-facing summary. Deliberately NOT the render payload: hundreds of
   * nodes of JSON is unusable to an LLM and would blow the MCP wire cap. The
   * server does the arithmetic, the agent interprets it.
   */
  async summary(opts: { projection?: string; days?: number } = {}) {
    const g = await this.build(opts);
    return {
      projection: g.projection,
      windowDays: g.stats.windowDays,
      mentionsConsidered: g.stats.mentionsConsidered,
      clusters: g.clusters.slice(0, 8).map((c) => ({
        label: c.label,
        size: c.size,
        avgSentiment: c.avgSentiment,
        terms: c.terms,
      })),
      bridges: g.bridges.slice(0, 8).map((b) => b.label),
      gaps: g.gaps.map((x) => ({ between: [x.a, x.b], bridges: x.bridges })),
      note:
        'Clusters are Louvain communities over concept co-occurrence. "bridges" connect otherwise ' +
        'separate clusters. "gaps" are cluster pairs the corpus barely connects — candidate content ' +
        'the community has not joined up yet.',
    };
  },
});

// Strapi's service loader reads the DEFAULT export — a named-only export
// compiles fine, registers nothing, and surfaces as `strapi.service(...)`
// returning undefined at call time.
export default graph;
