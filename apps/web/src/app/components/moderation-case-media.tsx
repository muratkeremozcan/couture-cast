'use client'

// Story 6.10 web owner: the one component that owns a case image.
// The signed URL goes straight into a plain img with no referrer and never into the Next image
// optimizer, so it cannot reach an intermediary cache. At expiry the image is replaced by a Reload control.
import { useEffect, useState } from 'react'
import type { ModerationMedia } from '@couture/api-client/contracts/http'
import { useModerationTranslation } from '../../lib/moderation'

const control =
  'min-h-[44px] min-w-[44px] rounded border border-neutral-500 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)]'

export function CaseMedia({
  media,
  clockOffsetMs,
  onReload,
}: {
  media: ModerationMedia
  clockOffsetMs: number
  /** A user-initiated detail read. It writes a new audit row by design. */
  onReload: () => void
}) {
  const { t } = useModerationTranslation()
  const expiresAt = media.state === 'available' ? Date.parse(media.expiresAt) : null
  const [expired, setExpired] = useState(
    () => expiresAt !== null && expiresAt <= Date.now() + clockOffsetMs
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    if (expiresAt === null) {
      setExpired(false)
      return
    }
    const wait = expiresAt - (Date.now() + clockOffsetMs)
    if (wait <= 0) {
      setExpired(true)
      return
    }
    setExpired(false)
    const timer = window.setTimeout(() => setExpired(true), wait)
    return () => window.clearTimeout(timer)
  }, [expiresAt, clockOffsetMs])

  if (media.state === 'unavailable') {
    return (
      <p className="rounded border border-dashed border-neutral-500 p-4 text-sm">
        {t(`moderation.mediaReason.${media.reason}`)}
      </p>
    )
  }
  if (expired || failed) {
    return (
      <div className="flex flex-col items-start gap-3 rounded border border-dashed border-neutral-500 p-4 text-sm">
        <p>{t(failed ? 'moderation.media.failed' : 'moderation.media.expired')}</p>
        <button type="button" className={control} onClick={onReload}>
          {t('moderation.media.reload')}
        </button>
      </div>
    )
  }
  return (
    <figure className="m-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- the signed URL must not pass through the image optimizer */}
      <img
        src={media.url}
        alt={media.altText?.trim() ? media.altText : t('moderation.media.noAlt')}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailed(true)}
        className="max-h-[70vh] w-full rounded bg-neutral-200 object-contain dark:bg-neutral-800"
      />
    </figure>
  )
}
