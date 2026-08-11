// Story 5.1 Task 7 owner: the real Web settings page, replacing the placeholder.
'use client'

import { I18nextProvider } from 'react-i18next'
import { getI18n } from '../../i18n'
import { CommercePreferencesSection } from '../components/commerce-preferences-section'
import { StickyBottomNav } from '../components/sticky-bottom-nav'

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
export default function SettingsPage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <main
        id="main-content"
        tabIndex={-1}
        data-focus-surface="dark"
        className="min-h-screen bg-neutral-950 px-6 py-16 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] text-white outline-none"
      >
        <h1 className="text-4xl font-semibold">Settings</h1>
        <CommercePreferencesSection />
        <StickyBottomNav />
      </main>
    </I18nextProvider>
  )
}
