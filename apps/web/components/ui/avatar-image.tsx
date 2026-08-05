'use client'

import { useCallback, useState } from 'react'

/**
 * Remote profile picture with a fallback to the initial.
 *
 * Social CDNs 404, hotlink-block, and expire — a bare <img> then renders the
 * browser's broken-image glyph, which looks like a bug in Pulse rather than a
 * dead URL on someone else's server. Its own client component so the rest of
 * ui.tsx stays server-rendered.
 *
 * Width and height are set explicitly: without them a page of lazy-loading
 * avatars reflows as each one resolves, which is both visible jitter and a
 * source of flaky click targets.
 */
export function AvatarImage({
  src,
  name,
  className,
  px,
}: {
  src: string
  name?: string | null
  className: string
  px: number
}) {
  const [failed, setFailed] = useState(false)

  // The <img> is server-rendered, so a broken URL usually fails BEFORE React
  // hydrates — and an onError that was missed never fires again, leaving the
  // browser's broken-image glyph on screen for good. Re-check the real element
  // on mount: complete with zero natural width means it already failed.
  const check = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth === 0) setFailed(true)
  }, [])
  if (failed) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[#4945FF] to-[#7B79FF] font-semibold text-white ${className}`}
      >
        {(name ?? '?').charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      ref={check}
      onError={() => setFailed(true)}
      className={`inline-block rounded-full object-cover ${className}`}
    />
  )
}
