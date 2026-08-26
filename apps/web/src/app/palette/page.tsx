// Story 5.4 Task 7 owner: the Web colour palette & beauty/accessory advisor route.
'use client'

import { I18nextProvider } from 'react-i18next'
import { getI18n } from '../../i18n'
import { PaletteAdvisorPanel } from '../components/palette-advisor-panel'
import { StickyBottomNav } from '../components/sticky-bottom-nav'

/**
 * Four things on the `<main>` below are load-bearing and must survive any
 * redesign of this page, because `playwright/tests/accessibility-hardening.spec.ts`
 * runs `/palette` through `expectSkipContract` plus a full axe WCAG2A/2AA scan
 * at 1440x900 and 375x812:
 *
 * - `id="main-content"`, the target of the global skip link.
 * - `tabIndex={-1}`, so activating that link can move focus here.
 * - `data-focus-surface="dark"`, which switches `--focus-essential` to white in
 *   `globals.css` and is what keeps the focus ring visible on this surface.
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
 * The page deliberately renders no `<h1>` of its own. `/settings` carries a
 * hardcoded English one because it hosts three unrelated sections that each
 * need a heading beneath it; this route hosts exactly one panel, so the panel's
 * own localized heading IS the page heading. A second, untranslated one would
 * have said the same thing twice, once in English only.
 */
export default function PalettePage() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <main
        id="main-content"
        tabIndex={-1}
        data-focus-surface="dark"
        className="min-h-screen bg-neutral-950 px-6 py-16 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] text-white outline-none"
      >
        <PaletteAdvisorPanel />
        <StickyBottomNav />
      </main>
    </I18nextProvider>
  )
}
