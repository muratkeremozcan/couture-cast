// Story 5.1 Task 7 owner: the real Web settings page, replacing the placeholder.
// 2026-11-19: the page reads Profile (title and bottom nav) and names the signed-in account
// above its sections; the route stays /settings.
'use client'

import Link from 'next/link'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { CommercePreferencesSection } from '../components/commerce-preferences-section'
import { LocationsSection } from '../components/locations/locations-section'
import { PremiumThemeSection } from '../components/premium-theme-section'
import { ProfileAccount } from '../components/profile-account'
import { ScreenGate } from '../components/screen-gate'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import { SubscriptionSection } from '../components/subscription-section'

/**
 * Four things on the `<main>` below are load-bearing and must survive any
 * redesign of this page, because `playwright/tests/accessibility-hardening.spec.ts`
 * runs `/settings` through `expectSkipContract` plus a full axe WCAG2A/2AA scan
 * at 1440x900 and 375x812:
 *
 * - `id="main-content"`, the target of the global skip link.
 * - `tabIndex={-1}`, so activating that link can move focus here.
 * - `data-focus-surface="dark"`, which switches `--focus-essential` to white in
 *   `globals.css` and is what keeps the focus ring visible on this surface.
 * - `<StickyBottomNav />`, the mobile navigation every destination route ships.
 *
 * That suite loads the route signed out, so every child has to render cleanly
 * with no session.
 */
/** Inside the provider, so the heading follows the reader's locale. */
function SettingsTitle() {
  const { t } = useTranslation()
  return (
    <header data-testid="app-header">
      <Link href="/" className="hidden min-h-11 items-center underline md:inline-flex">
        {t('nav.home')}
      </Link>
      <h1 className="text-4xl font-semibold">{t('settings.title')}</h1>
    </header>
  )
}

export default function SettingsPage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <main
        id="main-content"
        tabIndex={-1}
        data-focus-surface="dark"
        className="min-h-screen bg-neutral-950 px-6 py-16 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] text-white outline-none"
      >
        <SettingsTitle />
        {/* Story CC-7.7 D3 (amended): the body appears once the locations, shopping,
            subscription and theme reads have answered; each used to land and push the next. The
            account header above them keeps its own space while it reads (profile-account.tsx). */}
        <ScreenGate screen="profile" reads={PROFILE_GATE_READS}>
          <ProfileAccount />
          {/* Rendered in the first HTML: only its guided-entry query reader waits for the
              client, inside its own boundary (Codex review P2-3). */}
          <LocationsSection />
          <CommercePreferencesSection />
          <SubscriptionSection />
          <PremiumThemeSection />
        </ScreenGate>
        <StickyBottomNav />
      </main>
    </I18nextProvider>
  )
}

const PROFILE_GATE_READS = ['locations', 'commerce', 'subscription', 'theme'] as const
