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

interface Account {
  displayName: string | null
  email: string
}

export function ProfileAccount() {
  const { t } = useTranslation()
  const session = useWebSession()
  const owner = session.status === 'signed_in' ? session.owner : null
  const [account, setAccount] = useState<Account | null>(null)

  // One profile request per member, like the Locations list.
  useEffect(() => {
    setAccount(null)
    if (!owner) return
    const controller = new AbortController()
    getSignedInUserProfileFromWeb(controller.signal)
      .then(({ user }) => {
        if (controller.signal.aborted) return
        setAccount({ displayName: user.displayName?.trim() || null, email: user.email })
      })
      .catch(() => {
        // The header is a courtesy: every section below reports its own failures.
      })
    return () => controller.abort()
  }, [owner])

  if (!account) return null

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
