/**
 * A visible mark on anything that is not production.
 *
 * Staging and production are the same UI pointed at different databases, and
 * the actions here are not read-only: acknowledging a mention, recording a
 * reply, saving a lead profile. Doing one of those in the environment you did
 * not mean to is the failure this exists to prevent, and there is nothing on
 * screen to distinguish them otherwise.
 *
 * Absent in production by design — a banner that is always there stops being
 * read within a day, which would defeat the point.
 */
export function EnvironmentBanner() {
  const env = process.env.NEXT_PUBLIC_PULSE_ENV
  if (!env || env === 'production') return null

  // Anchored to the BOTTOM, not the top: the nav is `fixed top-0` and a second
  // fixed bar above it would mean shifting the nav, the content offset and the
  // mobile drawer — on a layout whose horizontal-scroll and touch-target
  // behaviour has its own e2e suite. A slim bottom bar is as persistent and
  // costs none of that.
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] bg-amber-500 px-4 py-1 text-center text-xs font-medium text-amber-950"
    >
      {env.toUpperCase()} — not production. Data here is seeded and safe to change.
    </div>
  )
}
