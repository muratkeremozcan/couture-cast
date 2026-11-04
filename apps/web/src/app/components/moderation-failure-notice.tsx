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
  /** A case read has its own wording for a generic failure. */
  scope?: 'queue' | 'case'
}) {
  const { t } = useModerationTranslation()
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded border border-neutral-500 p-4"
    >
      <p>
        {t(
          scope === 'case' && reason === 'unavailable'
            ? 'moderation.state.caseUnavailable'
            : `moderation.state.${reason}`
        )}
      </p>
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
          onClick={() => {
            if (!busy) onRetry()
          }}
        >
          {t('moderation.state.retry')}
        </button>
      ) : null}
    </div>
  )
}
