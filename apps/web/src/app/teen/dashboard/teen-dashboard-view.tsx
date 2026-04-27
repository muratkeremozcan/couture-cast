'use client'

import { useEffect, useState } from 'react'
import type { UserProfileResponse } from '@couture/api-client/contracts/http'
import { getUserProfileFromWeb } from '../../../lib/user'

type TeenDashboardViewProps = {
  loadProfile?: () => Promise<UserProfileResponse>
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

function getConsentStatus(profile: UserProfileResponse) {
  const hasGrantedGuardian = profile.linkedGuardians.some(
    (guardian) => guardian.status === 'granted'
  )
  const hasRevokedGuardian = profile.linkedGuardians.some(
    (guardian) => guardian.status === 'revoked'
  )

  if (hasGrantedGuardian) {
    return 'Guardian consent granted'
  }

  if (hasRevokedGuardian) {
    return 'Guardian consent revoked'
  }

  return 'Guardian consent pending'
}

export function TeenDashboardView({
  loadProfile = getUserProfileFromWeb,
}: TeenDashboardViewProps) {
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
            error instanceof Error ? error.message : 'Unable to load dashboard'
          )
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadProfile])

  if (errorMessage) {
    return (
      <section className="space-y-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-rose-100">
        <h1 className="text-xl font-semibold">Teen dashboard</h1>
        <p data-testid="teen-dashboard-error">{errorMessage}</p>
      </section>
    )
  }

  if (!profile) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 text-neutral-200">
        Loading guardian consent status...
      </section>
    )
  }

  return (
    <section className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200">
          Teen dashboard
        </p>
        <h1 className="text-2xl font-semibold text-white">
          {profile.user.displayName ?? profile.user.email}
        </h1>
        <p
          data-testid="teen-consent-status"
          className="text-sm font-semibold text-emerald-200"
        >
          {getConsentStatus(profile)}
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-300">
          Linked guardians
        </h2>
        {profile.linkedGuardians.length > 0 ? (
          <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
            {profile.linkedGuardians.map((guardian) => (
              <li
                key={guardian.guardianId}
                className="grid gap-2 px-4 py-3 text-sm text-neutral-100 sm:grid-cols-3"
              >
                <span className="font-medium">{guardian.guardianId}</span>
                <span>{guardian.status}</span>
                <span className="text-neutral-400">
                  {formatConsentDate(guardian.consentGrantedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">
            No guardian has accepted consent yet.
          </p>
        )}
      </div>
    </section>
  )
}
