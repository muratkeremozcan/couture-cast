// Story 5.4 Task 7 owner: the Web colour palette & beauty/accessory advisor route.
'use client'

import { I18nextProvider } from 'react-i18next'
import { getI18n } from '../../i18n'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { PaletteAdvisorPanel } from '../components/palette-advisor-panel'
import { StickyBottomNav } from '../components/sticky-bottom-nav'

/**
 * Four things on the page below are load-bearing and must survive any
 * redesign of this page, because `playwright/tests/accessibility-hardening.spec.ts`
 * runs `/palette` through `expectSkipContract` plus a full axe WCAG2A/2AA scan
 * at 1440x900 and 375x812:
 *
 * - `id="main-content"`, the target of the global skip link.
 * - `tabIndex={-1}`, so activating that link can move focus here.
 * - The focus ring tokens (`--cc-focus-essential`, `--cc-focus`) follow the scheme, which is
 *   what keeps the ring visible on the page surface in light and dark (Story CC-7.9 D3).
 * - `<StickyBottomNav />`, the mobile navigation every destination route ships.
 *
 * That suite loads the route signed out, so the panel has to render its locked
 * state cleanly with no session.
 *
 * The section body lives in `app/components/palette-advisor-panel.tsx` rather
 * than inline here, following the convention `wardrobe-onboarding-flow.tsx`
 * documents: Next.js generates route types from this directory, and a
 * non-route file under `app/palette/` would be typed as one.
 *
 * Story CC-7.9 D6, D7: the shared top bar and page surface replace the always-dark page. The
 * top bar's `h1` is the panel's own localized title, with back to Profile, where the palette
 * advisor is reached from; the panel's heading is an `h2` for assistive technology only.
 */
export default function PalettePage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <AppPage>
        <AppTopBar
          titleKey="commerce.premium.palette.sectionTitle"
          backHref="/settings"
        />
        <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
          <PaletteAdvisorPanel />
        </main>
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}
