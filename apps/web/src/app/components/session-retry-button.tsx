// Production follow-up after the project close (2026-11-19): when the session check fails (a
// timeout, a 5xx from the profile check), a member-owned section shows its load error with this
// control. It verifies the stored session again (`MemberSession.retry`), and the section reads
// once the member is named. It never says sign in: the member may well be signed in.
'use client'

import { useTranslation } from 'react-i18next'
import type { MemberSession } from '../../lib/use-web-session'

/**
 * Renders while the session check is out (`unavailable`), or while a read waits on a failed
 * recheck of the member's session (`recheck`, which reads again); otherwise nothing.
 */
export function SessionRetryButton({
  session,
  testId,
  recheck = null,
  className = 'mt-2 min-h-[44px] self-start rounded-md border border-neutral-500 px-4 text-sm text-white',
}: {
  session: MemberSession
  testId: string
  recheck?: (() => void) | null
  /** The dark Settings style by default; a light surface passes its own. */
  className?: string
}) {
  const { t } = useTranslation()
  const onRetry = session.status === 'unavailable' ? session.retry : recheck
  if (!onRetry) return null
  return (
    <button type="button" onClick={onRetry} className={className} data-testid={testId}>
      {t('session.retry')}
    </button>
  )
}
