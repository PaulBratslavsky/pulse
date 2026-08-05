'use client'

/** Dependency-free SVG line chart: Pulse score 0-100 with event markers. */
export default function TrendChart({
  series,
  events,
}: {
  series: Array<{ date: string; score: number | null; volume: number }>
  events: Array<{ documentId: string; title: string; date: string; kind: string }>
}) {
  const W = 900
  const H = 260
  const PAD = 30
  const n = series.length
  if (!n) return null

  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1)
  const y = (score: number) => H - PAD - (score / 100) * (H - 2 * PAD)

  const points = series
    .map((p, i) => (p.score == null ? null : `${x(i)},${y(p.score)}`))
    .filter(Boolean)
    .join(' ')

  const eventMarkers = events
    .map((e) => {
      const day = new Date(e.date).toISOString().slice(0, 10)
      const i = series.findIndex((p) => p.date === day)
      return i === -1 ? null : { ...e, i }
    })
    .filter(Boolean) as Array<{ i: number; title: string; kind: string; documentId: string }>

  /* Lay the event labels out in stacked lanes so close-together events don't
     print on top of each other (two releases a week apart used to collide).
     Walk left to right; a label drops to the next lane whenever it would start
     before the previous lane occupant ends. Labels near the right edge are
     anchored on the other side of their line so they stay inside the plot. */
  const CHAR_W = 5.4 // ≈ advance width of the 10px label face
  const LANE_H = 12
  const laneEnds: number[] = []
  const placedEvents = [...eventMarkers]
    .sort((a, b) => a.i - b.i)
    .map((e) => {
      const title = e.title.length > 24 ? `${e.title.slice(0, 23)}…` : e.title
      const w = title.length * CHAR_W + 8
      // flip to the left of the line when the label would overrun the plot
      const flip = x(e.i) + 3 + w > W - PAD
      const start = flip ? x(e.i) - 3 - w : x(e.i) + 3
      let lane = laneEnds.findIndex((end) => end <= start)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = start + w
      return { ...e, title, lane, flip }
    })

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[600px]">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
            <text x={4} y={y(g) + 4} className="fill-zinc-400 text-[10px]">{g}</text>
          </g>
        ))}
        {placedEvents.map((e) => (
          <g key={e.documentId}>
            <line x1={x(e.i)} x2={x(e.i)} y1={PAD} y2={H - PAD} className="stroke-amber-400" strokeDasharray="4 3" strokeWidth={1.5} />
            <text
              x={x(e.i) + (e.flip ? -3 : 3)}
              y={PAD + 10 + e.lane * LANE_H}
              textAnchor={e.flip ? 'end' : 'start'}
              className="fill-amber-500 text-[10px]"
            >
              {e.title}
              <title>{`${e.title} (${e.kind})`}</title>
            </text>
          </g>
        ))}
        <polyline points={points} fill="none" strokeWidth={2.5} className="stroke-zinc-900 dark:stroke-white" />
        {series.map((p, i) =>
          p.score == null ? null : (
            <circle key={p.date} cx={x(i)} cy={y(p.score)} r={2.5} className="fill-zinc-900 dark:fill-white">
              <title>{`${p.date}: ${p.score} (${p.volume} mentions)`}</title>
            </circle>
          )
        )}
        <text x={PAD} y={H - 8} className="fill-zinc-400 text-[10px]">{series[0]?.date}</text>
        <text x={W - PAD - 60} y={H - 8} className="fill-zinc-400 text-[10px]">{series[n - 1]?.date}</text>
      </svg>
    </div>
  )
}
