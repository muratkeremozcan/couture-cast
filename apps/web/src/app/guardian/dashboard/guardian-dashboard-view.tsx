'use client'

import { useEffect, useState } from 'react'
import type {
  GuardianConsentRevokeInput,
  GuardianConsentRevokeResponse,
  UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { revokeGuardianConsentFromWeb } from '../../../lib/guardian'
import { getUserProfileFromWeb } from '../../../lib/user'

type GuardianDashboardViewProps = {
  loadProfile?: () => Promise<UserProfileResponse>
  revokeConsent?: (
    input: GuardianConsentRevokeInput
  ) => Promise<GuardianConsentRevokeResponse>
}

function formatConsentDate(value: string | null) {
  if (!value) {
    return 'Awaiting consent'
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function GuardianDashboardView({
  loadProfile = getUserProfileFromWeb,
  revokeConsent = revokeGuardianConsentFromWeb,
}: GuardianDashboardViewProps) {
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
            error instanceof Error ? error.message : 'Unable to load dashboard'
          )
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadProfile])

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
        `Consent revoked for ${response.teenId}. Teen session invalidated: ${response.sessionInvalidated ? 'yes' : 'no'}.`
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to revoke consent')
    } finally {
      setPendingTeenId(null)
    }
  }

  if (errorMessage && !profile) {
    return (
      <section className="space-y-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-rose-100">
        <h1 className="text-xl font-semibold">Guardian dashboard</h1>
        <p data-testid="guardian-dashboard-error">{errorMessage}</p>
      </section>
    )
  }

  if (!profile) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 text-neutral-200">
        Loading linked teens...
      </section>
    )
  }

  return (
    <section className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200">
          Guardian dashboard
        </p>
        <h1 className="text-2xl font-semibold text-white">
          {profile.user.displayName ?? profile.user.email}
        </h1>
        <p className="text-sm text-neutral-300">
          Review linked teen accounts and revoke consent when access should stop.
        </p>
      </div>

      {message ? (
        <p
          data-testid="guardian-dashboard-message"
          className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}

      {errorMessage ? (
        <p
          data-testid="guardian-dashboard-error"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          aria-live="assertive"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-300">
          Linked teens
        </h2>
        {profile.linkedTeens.length > 0 ? (
          <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
            {profile.linkedTeens.map((teen) => (
              <li
                key={teen.teenId}
                data-testid={`linked-teen-${teen.teenId}`}
                className="grid gap-3 px-4 py-3 text-sm text-neutral-100 md:grid-cols-[1fr_0.8fr_1fr_auto] md:items-center"
              >
                <span className="font-medium">{teen.teenId}</span>
                <span>{teen.status}</span>
                <span className="text-neutral-400">
                  {formatConsentDate(teen.consentGrantedAt)}
                </span>
                {teen.status === 'granted' ? (
                  <button
                    type="button"
                    disabled={pendingTeenId === teen.teenId}
                    onClick={() => {
                      void handleRevoke(teen.teenId)
                    }}
                    aria-label={`Revoke consent for ${teen.teenId}`}
                    className="rounded-full border border-rose-300/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {pendingTeenId === teen.teenId ? 'Revoking...' : 'Revoke'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-neutral-300">
            No linked teen accounts yet.
          </p>
        )}
      </div>
    </section>
  )
}
