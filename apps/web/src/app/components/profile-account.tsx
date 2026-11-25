// Production follow-up after the project close (2026-11-19): Jade looked for her profile and
// found a page called Settings with no sign of her account on it. The page is now Profile, and
// this header names the signed-in account (display name when there is one, always the email)
// above the sections. Signed out, or while the session is still being verified, it renders
// nothing, so the unauthenticated accessibility audit of `/settings` sees the page unchanged.
'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWebSession } from '../../lib/use-web-session'
import { getSignedInUserProfileFromWeb } from '../../lib/user'
import { useGuestFirstPaint, useSectionSnapshot } from './screen-gate'

interface Account {
  displayName: string | null
  email: string
}

export function ProfileAccount() {
  const { t } = useTranslation()
  const session = useWebSession()
  const owner = session.status === 'signed_in' ? session.owner : null
  // Story CC-7.7 D5 (Codex review P1-2): a return to Profile shows this member's account at once
  // and reads it again in place.
  const snapshot = useSectionSnapshot<Account>('account', owner)
  const restoredFor = snapshot.restoredFor
  const [account, setAccount] = useState<Account | null>(() => snapshot.restored ?? null)
  // The member whose profile read answered, with an account or without one.
  const [answeredFor, setAnsweredFor] = useState<string | null>(restoredFor)
  /*
   * Story CC-7.7: the account sits at the top of Profile, above every section. Its read is the
   * same request the session's own verification makes, so Profile's gate does not wait for it
   * (CI real-session PS-2 on 61d7156e: a reload held the whole page behind a verification still
   * out). Instead the header keeps its two lines while a member's read is out, or while a page
   * painted for a stored session is still checked, so the account never pushes the sections
   * below it when it lands.
   */
  const guestFirstPaint = useGuestFirstPaint()
  const reserved =
    (owner !== null && answeredFor !== owner) ||
    (session.status === 'checking' && !guestFirstPaint)

  const { beginRead, remember } = snapshot
  // One profile request per member, like the Locations list. The restored member's account
  // stays on screen while it is read again; a failed refresh keeps it.
  useEffect(() => {
    if (owner === null || owner !== restoredFor) setAccount(null)
    if (!owner) return
    const controller = new AbortController()
    beginRead()
    getSignedInUserProfileFromWeb(controller.signal)
      .then(({ user }) => {
        if (controller.signal.aborted) return
        const next = { displayName: user.displayName?.trim() || null, email: user.email }
        setAccount(next)
        setAnsweredFor(owner)
        remember(next)
      })
      .catch(() => {
        // The header is a courtesy: every section below reports its own failures.
        if (!controller.signal.aborted) setAnsweredFor(owner)
      })
    return () => controller.abort()
  }, [owner, restoredFor, beginRead, remember])

  if (!account)
    return reserved ? (
      <div
        aria-hidden="true"
        data-testid="profile-account-reserved"
        className="mt-4 max-w-2xl"
      >
        <p className="text-lg font-semibold">&nbsp;</p>
        <p className="text-sm">&nbsp;</p>
      </div>
    ) : null

  return (
    <section
      aria-label={t('settings.account')}
      data-testid="profile-account"
      className="mt-4 max-w-2xl"
    >
      {account.displayName && (
        <p
          className="text-lg font-semibold text-white"
          data-testid="profile-account-name"
        >
          {account.displayName}
        </p>
      )}
      <p
        className="break-all text-sm text-neutral-300"
        data-testid="profile-account-email"
      >
        {account.email}
      </p>
    </section>
  )
}
