'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { currentWebSessionScope, useWebSessionScope } from '../../lib/use-web-session'
import { getSignedInUserProfileFromWeb } from '../../lib/user'

export function ProfileAccount() {
  const scope = useWebSessionScope()
  return <MemberAccount key={scope} scope={scope} />
}

function MemberAccount({ scope }: { scope: string | null }) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [account, setAccount] = useState<{ displayName: string | null; email: string }>()
  useEffect(() => {
    if (!scope || currentWebSessionScope() !== scope) return
    const controller = new AbortController()
    void getSignedInUserProfileFromWeb(controller.signal)
      .then(({ user }) => {
        if (controller.signal.aborted || currentWebSessionScope() !== scope) return
        setAccount({ displayName: user.displayName?.trim() || null, email: user.email })
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [scope])

  return (
    <section
      aria-label={t('settings.profile.account')}
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
      <p
        className="text-sm text-ink-soft [overflow-wrap:anywhere]"
        data-testid="profile-account-email"
      >
        {account?.email ?? t('settings.profile.unavailable')}
      </p>
    </section>
  )
}
