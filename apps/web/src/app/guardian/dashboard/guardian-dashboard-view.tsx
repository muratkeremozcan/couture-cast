'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  GuardianConsentRevokeInput,
  GuardianConsentRevokeResponse,
  UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { revokeGuardianConsentFromWeb } from '../../../lib/guardian'
import { getUserProfileFromWeb } from '../../../lib/user'

type GuardianDashboardViewProps = {
  loadProfile?: () => Promise<UserProfileResponse>
  revokeConsent?: (
    input: GuardianConsentRevokeInput
  ) => Promise<GuardianConsentRevokeResponse>
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

export function GuardianDashboardView({
  loadProfile = getUserProfileFromWeb,
  revokeConsent = revokeGuardianConsentFromWeb,
}: GuardianDashboardViewProps) {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingTeenId, setPendingTeenId] = useState<string | null>(null)

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
            error instanceof Error ? error.message : t('guardian.dashboard.loadFailed')
          )
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadProfile, t])

  async function handleRevoke(teenId: string) {
    if (!profile) {
      return
    }

    setPendingTeenId(teenId)
    setErrorMessage(null)
    setMessage(null)

    try {
      const response = await revokeConsent({
        guardianId: profile.user.id,
        teenId,
      })
      setProfile({
        ...profile,
        linkedTeens: profile.linkedTeens.map((teen) =>
          teen.teenId === teenId
            ? {
                ...teen,
                status: 'revoked',
                consentGrantedAt: teen.consentGrantedAt,
              }
            : teen
        ),
      })
      setMessage(
        t('guardian.dashboard.revoked', {
          teenId: response.teenId,
          invalidated: t(
            response.sessionInvalidated
              ? 'guardian.dashboard.yes'
              : 'guardian.dashboard.no'
          ),
        })
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('guardian.dashboard.revokeFailed')
      )
    } finally {
      setPendingTeenId(null)
    }
  }

  if (errorMessage && !profile) {
    return (
      // Story CC-7.9 D6: the top bar already reads "Guardian dashboard", so the error panel
      // no longer repeats it as a heading.
      <section className="rounded-xl border border-danger-line bg-danger-surface p-6 text-danger-ink">
        <p data-testid="guardian-dashboard-error">{errorMessage}</p>
      </section>
    )
  }

  if (!profile) {
    return (
      <section
        data-surface="card"
        className="rounded-xl border border-line bg-card p-6 text-ink-soft"
      >
        {t('guardian.dashboard.loading')}
      </section>
    )
  }

  return (
    // Story CC-7.9 D6, D7: the one card on the page. The top bar shows "Guardian dashboard" and
    // owns the only h1, so the eyebrow is gone and the account name is an h2.
    <section
      data-surface="card"
      className="space-y-6 rounded-xl border border-line bg-card p-6"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-ink">
          {profile.user.displayName ?? profile.user.email}
        </h2>
        <p className="text-sm text-ink-soft">{t('guardian.dashboard.intro')}</p>
      </div>

      {message ? (
        <p
          data-testid="guardian-dashboard-message"
          className="rounded-lg border border-line px-4 py-3 text-sm text-success-ink"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}

      {errorMessage ? (
        <p
          data-testid="guardian-dashboard-error"
          className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger-ink"
          aria-live="assertive"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-muted">
          {t('guardian.dashboard.linkedTeens')}
        </h3>
        {profile.linkedTeens.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {profile.linkedTeens.map((teen) => (
              <li
                key={teen.teenId}
                data-testid={`linked-teen-${teen.teenId}`}
                className="grid gap-3 px-4 py-3 text-sm text-ink md:grid-cols-[1fr_0.8fr_1fr_auto] md:items-center"
              >
                <span className="font-medium">{teen.teenId}</span>
                <span>{t(`guardian.consent.status.${teen.status}`)}</span>
                <span className="text-ink-muted">
                  {formatConsentDate(teen.consentGrantedAt, t, i18n.language)}
                </span>
                {teen.status === 'granted' ? (
                  <button
                    type="button"
                    disabled={pendingTeenId === teen.teenId}
                    onClick={() => {
                      void handleRevoke(teen.teenId)
                    }}
                    aria-label={t('guardian.dashboard.revokeLabel', {
                      teenId: teen.teenId,
                    })}
                    className="rounded-full border border-danger-line bg-page px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-danger-ink transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {pendingTeenId === teen.teenId
                      ? t('guardian.dashboard.revoking')
                      : t('guardian.dashboard.revoke')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-line px-4 py-3 text-sm text-ink-soft">
            {t('guardian.dashboard.empty')}
          </p>
        )}
      </div>
    </section>
  )
}
