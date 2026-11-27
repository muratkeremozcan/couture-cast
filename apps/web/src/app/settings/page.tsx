'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { I18nextProvider, useTranslation } from 'react-i18next'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { ProfileSignOut } from '../components/guest-preview/guest-preview-entry'
import { NavRow } from '../components/nav-row'
import {
  ScreenGate,
  useScreenGateRead,
  useSectionSnapshot,
} from '../components/screen-gate'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import { communitySyncFromWeb } from '../../lib/community'
import { captureLocationCredentials, listLocationsFromWeb } from '../../lib/locations'
import { getPremiumAccessFromWeb } from '../../lib/premium'
import {
  currentWebSessionScope,
  useWebSession,
  useWebSessionScope,
} from '../../lib/use-web-session'
import { getSignedInUserProfileFromWeb } from '../../lib/user'
import { getOnboardingStateFromWeb } from '../../lib/wardrobe'

const PROFILE_GATE_READS = ['profile-summary'] as const

type Summary = {
  name?: string | null
  place?: string | null
  setup?: 'not_started' | 'in_progress' | 'completed'
  premium?: boolean
  notifications?: boolean
}

export default function SettingsPage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <AppPage>
        <AppTopBar titleKey="nav.profile" wrapTitle />
        <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
          <LegacySettingsReturn />
          <ScreenGate screen="profile" reads={PROFILE_GATE_READS}>
            <ProfileRows />
          </ScreenGate>
          <ProfileSignOut />
        </main>
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}

function LegacySettingsReturn() {
  const router = useRouter()
  useEffect(() => {
    const redirect = () => {
      const { search, hash } = window.location
      const query = new URLSearchParams(search)
      if (query.has('checkout') || query.has('portal') || hash === '#premium') {
        router.replace(`/settings/premium${search}${hash}`)
      } else if (query.has('addLocation') || hash === '#locations') {
        router.replace(`/settings/places${search}${hash}`)
      }
    }
    redirect()
    window.addEventListener('hashchange', redirect)
    return () => window.removeEventListener('hashchange', redirect)
  }, [router])
  return null
}

function ProfileRows() {
  const session = useWebSession()
  const scope = useWebSessionScope()
  return (
    <MemberProfileRows
      key={scope}
      scope={scope}
      owner={session.status === 'signed_in' ? session.owner : null}
    />
  )
}

function MemberProfileRows({
  owner,
  scope,
}: {
  owner: string | null
  scope: string | null
}) {
  const { t, i18n } = useTranslation()
  const { restored, remember, beginRead } = useSectionSnapshot<Summary>('summary', owner)
  const [summary, setSummary] = useState<Summary | undefined>(restored)
  const settled = summary !== undefined
  useScreenGateRead('profile-summary', settled)
  useEffect(() => {
    if (!owner || !scope || currentWebSessionScope() !== scope) return
    const controller = new AbortController()
    const { signal } = controller
    beginRead()
    const credentials = captureLocationCredentials()
    const read = async () => {
      const [account, places, setup, premium, notifications] = await Promise.allSettled([
        getSignedInUserProfileFromWeb(signal),
        listLocationsFromWeb(signal, credentials ?? undefined),
        getOnboardingStateFromWeb(signal),
        getPremiumAccessFromWeb(signal),
        credentials
          ? communitySyncFromWeb(credentials.accessToken).preferences(signal)
          : Promise.reject(new Error('Missing notification credentials.')),
      ])
      if (signal.aborted || currentWebSessionScope() !== scope) return
      const next: Summary = { ...restored }
      if (account.status === 'fulfilled')
        next.name = account.value.user.displayName?.trim() || null
      if (places.status === 'fulfilled') {
        const primary = places.value.find((place) => place.isPrimary) ?? places.value[0]
        next.place = primary?.city || primary?.label || null
      }
      if (setup.status === 'fulfilled') next.setup = setup.value.status
      if (premium.status === 'fulfilled') next.premium = premium.value.premium
      if (notifications.status === 'fulfilled')
        next.notifications = notifications.value.enabled
      remember(next)
      setSummary(next)
    }
    void read()
    return () => controller.abort()
  }, [owner, scope, restored, remember, beginRead])

  const locale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  const neutral = t('settings.profile.unavailable')
  const notSet = t('settings.profile.notSet')
  const rows = [
    [
      'account',
      '/settings/account',
      summary?.name === null ? notSet : (summary?.name ?? neutral),
    ],
    [
      'places',
      '/settings/places',
      summary?.place === null ? notSet : (summary?.place ?? neutral),
    ],
    [
      'style',
      '/settings/style',
      summary?.setup ? t(`settings.profile.setup.${summary.setup}`) : neutral,
    ],
    [
      'premium',
      '/settings/premium',
      summary?.premium === undefined
        ? neutral
        : t(
            summary.premium
              ? 'settings.profile.premiumActive'
              : 'settings.profile.premiumFree'
          ),
    ],
    [
      'notifications',
      '/notification-settings',
      summary?.notifications === undefined
        ? neutral
        : t(summary.notifications ? 'settings.profile.on' : 'settings.profile.off'),
    ],
    ['language', '/settings/language', t(`settings.profile.languages.${locale}`)],
    ['about', '/settings/about', 'CoutureCast'],
  ] as const

  return (
    <nav aria-label={t('nav.profile')}>
      {rows.map(([id, href, value]) => (
        <NavRow
          key={id}
          href={href}
          label={t(`settings.profile.${id}`)}
          value={value}
          testId={`profile-${id}-row`}
        />
      ))}
    </nav>
  )
}
