'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Graph from 'graphology'
import Sigma from 'sigma'
import forceAtlas2 from 'graphology-layout-forceatlas2'

/**
 * The conversation map. Client-side because it is genuinely interactive —
 * pan, zoom, hover, click-through — and because ForceAtlas2 has to run to
 * settle the layout.
 *
 * Clustering already happened on the server, so this component never decides
 * what belongs together; it only draws what it was given. That keeps every
 * viewer looking at the same map and keeps a phone from doing graph maths.
 */

export type GraphNode = {
  id: string
  kind: string
  label: string
  weight: number
  cluster?: number
  meta?: { avgSentiment?: number | null }
}
export type GraphEdge = { source: string; target: string; weight: number; kind?: string }

/** Add a node kind, add a style. The renderer needs no other change — this is
 *  what lets a new projection ship without touching the frontend. */
const KIND_STYLE: Record<string, { base: number; shape: 'circle' }> = {
  term: { base: 4, shape: 'circle' },
  topic: { base: 5, shape: 'circle' },
  author: { base: 5, shape: 'circle' },
}

/** Cluster palette. Distinguishable in both themes, and deliberately not
 *  red/green-only so sentiment colouring stays readable alongside it. */
const CLUSTER_COLORS = [
  '#4945FF', '#0EA5E9', '#F59E0B', '#EC4899', '#10B981',
  '#8B5CF6', '#EF4444', '#14B8A6', '#F97316', '#6366F1',
]

const sentimentColor = (s?: number | null) =>
  s == null ? '#a1a1aa' : s > 0.15 ? '#10b981' : s < -0.15 ? '#ef4444' : '#a1a1aa'

export default function GraphView({
  nodes,
  edges,
  colorBy,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  colorBy: 'cluster' | 'sentiment'
}) {
  const holder = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const [hovered, setHovered] = useState<string | null>(null)
  const hoveredRef = useRef<string | null>(null)

  // Neighbour lookup drives the hover highlight; recomputed only when the
  // graph itself changes, never on every pointer move.
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, new Set())
      if (!m.has(e.target)) m.set(e.target, new Set())
      m.get(e.source)!.add(e.target)
      m.get(e.target)!.add(e.source)
    }
    return m
  }, [edges])

  useEffect(() => {
    if (!holder.current || nodes.length === 0) return

    const graph = new Graph({ type: 'undirected' })
    const maxWeight = Math.max(1, ...nodes.map((n) => n.weight))

    for (const n of nodes) {
      const style = KIND_STYLE[n.kind] ?? KIND_STYLE.term
      graph.addNode(n.id, {
        label: n.label,
        // sqrt so one very frequent concept doesn't dwarf everything else
        size: style.base + Math.sqrt(n.weight / maxWeight) * 12,
        color:
          colorBy === 'sentiment'
            ? sentimentColor(n.meta?.avgSentiment)
            : CLUSTER_COLORS[(n.cluster ?? 0) % CLUSTER_COLORS.length],
        // deterministic seed positions: ForceAtlas2 needs a non-degenerate
        // start, and a fixed seed keeps the map recognisable between loads
        x: Math.cos(hashAngle(n.id)) * (1 + (n.cluster ?? 0)),
        y: Math.sin(hashAngle(n.id)) * (1 + (n.cluster ?? 0)),
        kind: n.kind,
      })
    }
    for (const e of edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue
      if (graph.hasEdge(e.source, e.target)) continue
      graph.addEdge(e.source, e.target, { weight: e.weight, size: Math.min(3, 0.4 + e.weight / 8) })
    }

    // Synchronous, bounded iterations rather than the worker: the graph is
    // capped server-side at ~1200 edges, which settles in well under a frame
    // budget we'd otherwise spend on worker setup.
    forceAtlas2.assign(graph, {
      iterations: 220,
      settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 400 },
    })

    const renderer = new Sigma(graph, holder.current, {
      renderLabels: true,
      labelDensity: 0.6,
      labelGridCellSize: 70,
      labelRenderedSizeThreshold: 7,
      defaultEdgeColor: '#d4d4d8',
      minCameraRatio: 0.08,
      maxCameraRatio: 8,
    })

    // Dim everything except the hovered node and its neighbours — the single
    // interaction that makes a dense graph legible.
    renderer.setSetting('nodeReducer', (id, data) => {
      const h = hoveredRef.current
      if (!h) return data
      if (id === h) return { ...data, zIndex: 2, highlighted: true }
      if (neighbours.get(h)?.has(id)) return { ...data, zIndex: 1 }
      return { ...data, color: '#e4e4e7', label: '', zIndex: 0 }
    })
    renderer.setSetting('edgeReducer', (id, data) => {
      const h = hoveredRef.current
      if (!h) return data
      const [s, t] = graph.extremities(id)
      return s === h || t === h ? { ...data, color: '#71717a' } : { ...data, hidden: true }
    })

    const refresh = () => renderer.refresh({ skipIndexation: true })
    renderer.on('enterNode', ({ node }) => {
      hoveredRef.current = node
      setHovered(node)
      refresh()
    })
    renderer.on('leaveNode', () => {
      hoveredRef.current = null
      setHovered(null)
      refresh()
    })
    // click-through: the map feeds the queue, which is where the work happens
    renderer.on('clickNode', ({ node }) => {
      const label = graph.getNodeAttribute(node, 'label') as string
      const kind = graph.getNodeAttribute(node, 'kind') as string
      const q = kind === 'author' ? label.replace(/^@/, '') : label
      router.push(`/?q=${encodeURIComponent(q)}`)
    })

    return () => renderer.kill()
  }, [nodes, edges, colorBy, neighbours, router])

  if (nodes.length === 0) return null

  return (
    <div className="relative">
      {/* overflow-hidden + a fixed height: the canvas must never be able to
          widen the page, which e2e/responsive.spec.ts asserts on every route */}
      <div
        ref={holder}
        data-testid="graph-canvas"
        className="h-[70vh] max-h-[720px] min-h-[380px] w-full overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      />
      <p className="mt-2 text-xs text-zinc-500">
        {hovered ? (
          <>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{hovered}</span> —{' '}
            {neighbours.get(hovered)?.size ?? 0} connections. Click to see the mentions.
          </>
        ) : (
          'Hover a node to isolate its connections · click to open those mentions · scroll to zoom, drag to pan'
        )}
      </p>
    </div>
  )
}

/** Stable pseudo-angle from a node id, so seeding is deterministic without
 *  Math.random (which would reshuffle the map on every render). */
function hashAngle(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (h % 360) * (Math.PI / 180)
}
