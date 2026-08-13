import { EmptyState } from '@/components/ui'

export function QueueEmpty({ awaiting }: { awaiting?: string }) {
  return (
    <EmptyState title={awaiting ? 'Nothing waiting — on Reddit' : 'Queue is clear 🎉'}>
      {awaiting ? (
        // An empty result here must not read as "nobody is waiting on us".
        // Pulse can only see a follow-up when it can tell two mentions
        // belong to the same conversation, and only a Reddit permalink says
        // so — an X or LinkedIn URL carries no conversation id, and the
        // Octolens payload does not either. So this filter is Reddit-only,
        // and saying so is the difference between "clear" and "blind".
        <p className="mx-auto max-w-md text-sm text-zinc-500">
          Nobody is waiting on us in a Reddit thread. This flag cannot cover X or LinkedIn: their
          URLs carry nothing that says which conversation a post belongs to, so Pulse cannot tell a
          reply from a first post there. Someone may be waiting on those platforms and this filter
          would not show it.
        </p>
      ) : (
        <p className="mx-auto max-w-md text-sm text-zinc-500">
          Pulse collects data from launch onward — new mentions land here automatically as the
          webhook delivers them. If you just set up, point Octolens at{' '}
          <code className="text-xs">/api/octolens/ingest</code> and give it a minute.
        </p>
      )}
    </EmptyState>
  )
}
