// Story CC-7.12 D10 owner: what a free or signed-out member sees on Looks > Plan. One line on
// what Premium adds and one Upgrade button sit above a sample week (TEA P4), so no screen shows
// a Planner lock. Upgrade opens Profile's Premium section, or sign-in for a visitor (P5); it
// makes no purchase or entitlement call.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getGuestPreviewStrings, sampleLookText, sampleWeek } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { useWebSessionOwner } from '../../../lib/use-web-session'
import { SampleGarmentArt } from '../guest-preview/sample-garment-art'

export function FreePlanPreview() {
  const { t, i18n } = useTranslation('translation', {
    i18n: getI18n(),
    useSuspense: false,
  })
  const owner = useWebSessionOwner()
  const samples = getGuestPreviewStrings(i18n.language)
  const week = useMemo(() => sampleWeek(), [])
  const weekday = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'long' }),
    [i18n.language]
  )
  const today = new Date()
  return (
    <div data-testid="plan-free-preview" className="space-y-4">
      <p className="text-base text-ink">{t('looks.freePlan.line')}</p>
      <Link
        href={owner ? '/settings#premium' : '/signin'}
        data-testid="plan-upgrade"
        className="inline-flex min-h-touch items-center rounded-lg bg-primary px-6 text-sm font-semibold text-on-primary"
      >
        {t('looks.freePlan.upgrade')}
      </Link>
      <section aria-labelledby="plan-free-week">
        <h2 id="plan-free-week" className="text-sm font-semibold text-ink-soft">
          {t('looks.freePlan.week')}
        </h2>
        <ol className="mt-2">
          {week.map((day) => {
            const date = new Date(today)
            date.setDate(today.getDate() + day.offset)
            const garment = day.idea.garments[0]
            return (
              <li
                key={day.offset}
                data-testid={`plan-free-day-${day.offset}`}
                className="flex min-h-touch items-center gap-3 border-b border-line py-2 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-card-muted p-1"
                >
                  {garment ? (
                    <SampleGarmentArt garment={garment} className="h-full w-full" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">
                    {weekday.format(date)}
                  </span>
                  <span className="block truncate text-sm text-ink-muted">
                    {sampleLookText(day.idea.look, samples).name}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
