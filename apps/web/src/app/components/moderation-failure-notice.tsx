'use client'

// Story 6.10 web owner: the one place a failed read becomes words.
// A reason maps to one localized sentence. Retry shows only where retrying can work, and a signed-out
// moderator gets a sign-in link.
import Link from 'next/link'
import {
  useModerationTranslation,
  type ModerationFailureReason,
} from '../../lib/moderation'

const RETRYABLE: readonly ModerationFailureReason[] = [
  'audit_unavailable',
  'rate_limited',
  'unavailable',
  'invalid_cursor',
]

export const moderationControl =
  'min-h-[44px] min-w-[44px] rounded border border-neutral-500 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)] aria-disabled:opacity-60'

export function FailureNotice({
  reason,
  onRetry,
  busy = false,
  scope = 'queue',
}: {
  reason: ModerationFailureReason
  onRetry?: () => void
  busy?: boolean
  /** A case read and the SLA page have their own wording for what they cannot show. */
  scope?: 'queue' | 'case' | 'sla'
}) {
  const { t } = useModerationTranslation()
  const message =
    scope === 'case' && reason === 'unavailable'
      ? 'moderation.state.caseUnavailable'
      : scope === 'sla' && (reason === 'unavailable' || reason === 'disabled')
        ? `moderation.sla.${reason}`
        : `moderation.state.${reason}`
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded border border-neutral-500 p-4"
    >
      <p>{t(message)}</p>
      {reason === 'signed_out' ? (
        <Link href="/signin" className={`${moderationControl} inline-flex items-center`}>
          {t('moderation.state.signInLink')}
        </Link>
      ) : null}
      {onRetry && RETRYABLE.includes(reason) ? (
        <button
          type="button"
          className={moderationControl}
          aria-disabled={busy}
          aria-busy={busy}
          onClick={() => {
            if (!busy) onRetry()
          }}
        >
          {t(busy ? 'moderation.state.retrying' : 'moderation.state.retry')}
        </button>
      ) : null}
    </div>
  )
}
