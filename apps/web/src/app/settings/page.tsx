// Story 5.1 Task 7 owner: the real Web settings page, replacing the placeholder.
// 2026-11-19: the page reads Profile (title and bottom nav) and names the signed-in account
// above its sections; the route stays /settings.
'use client'

import { I18nextProvider, useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { CommercePreferencesSection } from '../components/commerce-preferences-section'
import { ProfileSignOut } from '../components/guest-preview/guest-preview-entry'
import { NavRow } from '../components/nav-row'
import { LocationsSection } from '../components/locations/locations-section'
import { PremiumThemeSection } from '../components/premium-theme-section'
import { ProfileAccount } from '../components/profile-account'
import { ScreenGate } from '../components/screen-gate'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import { SubscriptionSection } from '../components/subscription-section'

/**
 * Four things on the page below are load-bearing and must survive any redesign of this page,
 * because `playwright/tests/accessibility-hardening.spec.ts` runs `/settings` through
 * `expectSkipContract` plus a full axe WCAG2A/2AA scan at 1440x900 and 375x812:
 *
 * - `id="main-content"`, the target of the global skip link.
 * - `tabIndex={-1}`, so activating that link can move focus here.
 * - The focus ring tokens (`--cc-focus-essential`, `--cc-focus`) follow the scheme, which is what
 *   keeps the ring visible on the page surface in light and dark (Story CC-7.9 D3).
 * - `<StickyBottomNav />`, the mobile navigation every destination route ships.
 *
 * That suite loads the route signed out, so every child has to render cleanly
 * with no session.
 */
export default function SettingsPage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      {/* Story CC-7.9 D6, D7: the shared top bar and page surface; the always-dark page is gone. */}
      <AppPage>
        <AppTopBar titleKey="nav.profile" />
        <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
          {/* Each section sets its own top margin and rule, so the column adds no gap: a gap-8
              here doubled the space above every section. */}
          {/* Story CC-7.7 D3 (amended): the body appears once the locations, shopping,
              subscription and theme reads have answered; each used to land and push the next.
              The account header above them keeps its own space while it reads
              (profile-account.tsx). */}
          <ScreenGate screen="profile" reads={PROFILE_GATE_READS}>
            <ProfileAccount />
            {/* Story CC-7.11 D7: one Style row below the account header; the rest of Profile's
                layout is CC-7.16's. */}
            <ProfileRows />
            {/* Rendered in the first HTML: only its guided-entry query reader waits for the
                client, inside its own boundary (Codex review P2-3). */}
            <LocationsSection />
            <CommercePreferencesSection />
            <SubscriptionSection />
            <PremiumThemeSection />
          </ScreenGate>
          <ProfileSignOut />
        </main>
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}

/**
 * Story CC-7.11 D7: one Style row below the account header. Review #9: Notification settings is
 * a Profile row too (the Community bell stays). Locations stays inline until CC-7.16 gives
 * Profile its rows.
 */
function ProfileRows() {
  const { t } = useTranslation()
  return (
    <>
      <NavRow
        href="/settings/style"
        label={t('settings.style.row')}
        testId="profile-style-row"
      />
      <NavRow
        href="/notification-settings"
        label={t('community.notifications.title')}
        testId="profile-notifications-row"
        last
      />
    </>
  )
}

const PROFILE_GATE_READS = ['locations', 'commerce', 'subscription', 'theme'] as const
