'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { UserProfileResponse } from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { getUserProfileFromWeb } from '../../../lib/user'

type TeenDashboardViewProps = {
  loadProfile?: () => Promise<UserProfileResponse>
}

type ProfileWithOptionalGuardians = Omit<UserProfileResponse, 'linkedGuardians'> & {
  linkedGuardians?: UserProfileResponse['linkedGuardians']
}

function formatConsentDate(value: string | null, t: TFunction, locale: string) {
  if (!value) {
    return t('guardian.consent.awaiting')
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function getLinkedGuardians(profile: ProfileWithOptionalGuardians) {
  return profile.linkedGuardians ?? []
}

function getConsentStatus(profile: ProfileWithOptionalGuardians, t: TFunction) {
  const linkedGuardians = getLinkedGuardians(profile)
  const hasGrantedGuardian = linkedGuardians.some(
    (guardian) => guardian.status === 'granted'
  )
  const hasRevokedGuardian = linkedGuardians.some(
    (guardian) => guardian.status === 'revoked'
  )

  if (hasGrantedGuardian) {
    return t('teen.dashboard.granted')
  }

  if (hasRevokedGuardian) {
    return t('teen.dashboard.revoked')
  }

  return t('teen.dashboard.pending')
}

export function TeenDashboardView({
  loadProfile = getUserProfileFromWeb,
}: TeenDashboardViewProps) {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    loadProfile()
      .then((nextProfile) => {
        if (isMounted) {
          setProfile(nextProfile)
          setErrorMessage(null)
        }
      })
      .catch((error) => {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : t('teen.dashboard.loadFailed')
          )
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadProfile, t])

  if (errorMessage) {
    return (
      // Story CC-7.9 D6: the top bar already reads "Teen dashboard", so the error panel no
      // longer repeats it as a heading.
      <section className="rounded-xl border border-danger-line bg-danger-surface p-6 text-danger-ink">
        <p data-testid="teen-dashboard-error">{errorMessage}</p>
      </section>
    )
  }

  if (!profile) {
    return (
      <section
        data-surface="card"
        className="rounded-xl border border-line bg-card p-6 text-ink-soft"
      >
        {t('teen.dashboard.loading')}
      </section>
    )
  }

  const linkedGuardians = getLinkedGuardians(profile)

  return (
    // Story CC-7.9 D6, D7: the one card on the page. The top bar shows "Teen dashboard" and owns
    // the only h1, so the eyebrow is gone and the account name is an h2.
    <section
      data-surface="card"
      className="space-y-6 rounded-xl border border-line bg-card p-6"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-ink">
          {profile.user.displayName ?? profile.user.email}
        </h2>
        <p data-testid="teen-consent-status" className="text-sm font-semibold text-ink">
          {getConsentStatus(profile, t)}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-muted">
          {t('teen.dashboard.linkedGuardians')}
        </h3>
        {linkedGuardians.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {linkedGuardians.map((guardian) => (
              <li
                key={guardian.guardianId}
                className="grid gap-2 px-4 py-3 text-sm text-ink sm:grid-cols-3"
              >
                <span className="font-medium">{guardian.guardianId}</span>
                <span>{t(`guardian.consent.status.${guardian.status}`)}</span>
                <span className="text-ink-muted">
                  {formatConsentDate(guardian.consentGrantedAt, t, i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-notice-line bg-notice-surface px-4 py-3 text-sm text-notice-ink">
            {t('teen.dashboard.empty')}
          </p>
        )}
      </div>
    </section>
  )
}
