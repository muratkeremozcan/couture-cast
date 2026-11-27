'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import {
  currentWebSessionScope,
  useWebSession,
  useWebSessionScope,
} from '../../lib/use-web-session'
import { getSignedInUserProfileFromWeb } from '../../lib/user'

export function ProfileAccount() {
  const scope = useWebSessionScope()
  const session = useWebSession()
  return (
    <MemberAccount key={scope} scope={scope} checking={session.status === 'checking'} />
  )
}

function MemberAccount({ scope, checking }: { scope: string | null; checking: boolean }) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [account, setAccount] = useState<{
    displayName: string | null
    email: string
  } | null>()
  useEffect(() => {
    if (!scope || currentWebSessionScope() !== scope) return
    const controller = new AbortController()
    const stillCurrent = () =>
      !controller.signal.aborted && currentWebSessionScope() === scope
    void getSignedInUserProfileFromWeb(controller.signal)
      .then(({ user }) => {
        if (!stillCurrent()) return
        setAccount({ displayName: user.displayName?.trim() || null, email: user.email })
      })
      .catch(() => {
        if (stillCurrent()) setAccount(null)
      })
    return () => controller.abort()
  }, [scope])

  const loading = checking || (scope !== null && account === undefined)
  return (
    <section
      aria-label={t('settings.profile.account')}
      aria-busy={loading}
      data-testid="profile-account"
      className="min-h-12"
    >
      {account?.displayName && (
        <p
          className="text-lg font-semibold text-ink [overflow-wrap:anywhere]"
          data-testid="profile-account-name"
        >
          {account.displayName}
        </p>
      )}
      {loading ? (
        <div
          data-testid="profile-account-reserved"
          aria-hidden="true"
          className="min-h-5"
        />
      ) : (
        <p
          className="text-sm text-ink-soft [overflow-wrap:anywhere]"
          data-testid="profile-account-email"
        >
          {account?.email ?? t('settings.profile.unavailable')}
        </p>
      )}
    </section>
  )
}
