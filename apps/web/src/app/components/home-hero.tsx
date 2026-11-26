// Story CC-7.9 D7, D9: the Home landing hero on the page surface, its copy from the catalogs.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
'use client'

import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { AnalyticsEventActions } from './analytics-event-actions'
import { MemberWardrobeActions } from './guest-preview/guest-preview-entry'

/**
 * The hero reads nothing, and its landing actions follow `<html data-session>` from first paint,
 * so Home renders it outside the screen gate (CC-7.7 real-session L-10).
 */
export function HomeHero() {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <section id="ritual" data-testid="hero-section" className="flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
        {t('landing.hero.eyebrow')}
      </p>
      <h2 data-testid="hero-headline" className="text-3xl font-semibold leading-tight">
        {t('landing.hero.headline')}
      </h2>
      <p className="max-w-2xl text-lg text-ink-soft">{t('landing.hero.body')}</p>
      {/* TEA P3: one gap for the whole stack of landing actions, sign-in and analytics alike. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4" data-landing="member">
          <MemberWardrobeActions />
        </div>
        <AnalyticsEventActions />
      </div>
    </section>
  )
}

/** The brand line above Home's body; the tagline shows only on the signed-out landing. */
export function HomeBrandLine() {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <div className="flex flex-col gap-1">
      <p
        data-testid="app-badge"
        className="text-xs font-semibold uppercase tracking-widest text-ink-muted"
      >
        CoutureCast
      </p>
      <p data-landing="guest" className="text-sm text-ink-muted">
        {t('landing.tagline')}
      </p>
    </div>
  )
}
