// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19): the community heading
// and the climate filter explainer on Web.
//
// A tester read "Living community lookbook" as unclear and asked what the "Cold and
// wet" chip meant: nothing on the page said the chips filter looks by the weather
// they were shared in. Two contracts come out of that report, and this file pins
// both in every supported locale:
//
// - The heading is "Latest looks" in English. The feed is ordered newest-first by
//   `published_at`, so the name says what the list is. Every other locale must move
//   off its old "living lookbook" wording, which is pinned below from the baseline
//   catalogs so a rename that touched English alone stays red.
// - One visible explainer line sits under the heading, and the filter landmark is
//   described by it (`aria-describedby`), so a screen reader hears what the chips
//   do when it enters the group. `LookbookFilterNav` is exported and Home used to
//   mount two copies of it, so each mounted copy must point at its own explainer:
//   a shared literal id would resolve to the first one only.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getI18n, SUPPORTED_LOCALES, type SupportedLocale } from '../../i18n'
import deDE from '../../i18n/locales/de-DE.json'
import enCA from '../../i18n/locales/en-CA.json'
import enUS from '../../i18n/locales/en-US.json'
import es419 from '../../i18n/locales/es-419.json'
import frCA from '../../i18n/locales/fr-CA.json'
import frFR from '../../i18n/locales/fr-FR.json'
import itIT from '../../i18n/locales/it-IT.json'
import ptBR from '../../i18n/locales/pt-BR.json'
import ptPT from '../../i18n/locales/pt-PT.json'
import trTR from '../../i18n/locales/tr-TR.json'
import { LookbookFilterNav } from './community-lookbook-grid'

type CommunityStrings = {
  heading?: string
  filters?: { label?: string; explainer?: string }
}

const CATALOGS: Record<SupportedLocale, { community: CommunityStrings }> = {
  'en-US': enUS,
  'en-CA': enCA,
  'de-DE': deDE,
  'es-419': es419,
  'fr-CA': frCA,
  'fr-FR': frFR,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  'tr-TR': trTR,
}

/** `community.heading` at baseline f913ce6f, the wording the tester flagged. */
const RETIRED_HEADINGS: Record<SupportedLocale, string> = {
  'en-US': 'Living community lookbook',
  'en-CA': 'Living community lookbook',
  'de-DE': 'Lebendiges Community-Lookbook',
  'es-419': 'Lookbook vivo de la comunidad',
  'fr-CA': 'Carnet de looks vivant de la communauté',
  'fr-FR': 'Lookbook vivant de la communauté',
  'it-IT': 'Lookbook vivo della community',
  'pt-BR': 'Lookbook vivo da comunidade',
  'pt-PT': 'Álbum vivo de visuais da comunidade',
  'tr-TR': 'Yaşayan topluluk lookbook’u',
}

const ENGLISH_LOCALES: readonly SupportedLocale[] = ['en-US', 'en-CA']

function catalogStrings(locale: SupportedLocale) {
  const community = CATALOGS[locale].community
  return {
    heading: community.heading,
    label: community.filters?.label,
    explainer: community.filters?.explainer,
  }
}

function renderFilterNav() {
  return render(<LookbookFilterNav activeTab="all" onTabChange={vi.fn()} />)
}

afterEach(async () => {
  cleanup()
  await getI18n().changeLanguage('en-US')
})

describe('Community heading and climate filter explainer (web)', () => {
  it('names the feed "Latest looks" in English', () => {
    for (const locale of ENGLISH_LOCALES) {
      expect(catalogStrings(locale).heading, locale).toBe('Latest looks')
    }
  })

  it.each(SUPPORTED_LOCALES)(
    '%s renders the renamed heading and an explainer that describes the filters',
    async (locale) => {
      const { heading, label, explainer } = catalogStrings(locale)
      expect(heading, `${locale} community.heading`).toBeTruthy()
      expect(heading, `${locale} still ships the retired heading`).not.toBe(
        RETIRED_HEADINGS[locale]
      )
      expect(explainer, `${locale} community.filters.explainer`).toBeTruthy()

      await getI18n().changeLanguage(locale)
      renderFilterNav()

      const filters = screen.getByRole('navigation', { name: label })
      expect(
        within(filters).getByRole('heading', { level: 2, name: heading })
      ).toBeVisible()
      // Visible copy, not a tooltip: the tester had no way to discover a hover.
      expect(within(filters).getByText(explainer as string)).toBeVisible()
      expect(filters).toHaveAccessibleDescription(explainer as string)
    }
  )

  it('gives each rendered filter nav its own explainer', () => {
    const { explainer } = catalogStrings('en-US')
    render(
      <>
        <LookbookFilterNav activeTab="all" onTabChange={vi.fn()} />
        <LookbookFilterNav activeTab="auto" onTabChange={vi.fn()} />
      </>
    )

    const navs = screen.getAllByRole('navigation', { name: 'Community filters' })
    expect(navs).toHaveLength(2)

    const describedBy = navs.map((nav) => nav.getAttribute('aria-describedby'))
    expect(describedBy[0]).toBeTruthy()
    expect(describedBy[1]).toBeTruthy()
    expect(describedBy[0]).not.toBe(describedBy[1])

    navs.forEach((nav, index) => {
      const target = document.getElementById(describedBy[index]!)
      expect(target).not.toBeNull()
      expect(nav).toContainElement(target)
      expect(target).toHaveTextContent(explainer as string)
    })
  })
})
