// Learning path Step 72: Calm Community with an empty state.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { CommunityClimateFilter } from './community-lookbook-grid'

type CommunityStrings = {
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

afterEach(async () => {
  cleanup()
  await getI18n().changeLanguage('en-US')
})

describe('Community climate sheet explainer', () => {
  it.each(SUPPORTED_LOCALES)('%s describes the available filters', async (locale) => {
    const { label, explainer } = CATALOGS[locale].community.filters ?? {}
    expect(label).toBeTruthy()
    expect(explainer).toBeTruthy()
    const i18n = getI18n()
    await i18n.changeLanguage(locale)
    const user = userEvent.setup()
    render(
      <CommunityClimateFilter activeTab="all" viewerBand={null} onTabChange={vi.fn()}>
        {null}
      </CommunityClimateFilter>
    )

    expect(screen.queryByTestId('community-filters-explainer')).toBeNull()
    const trigger = screen.getByTestId('community-climate-filter')
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: label })
    expect(within(sheet).getByTestId('community-filters-explainer')).toHaveTextContent(
      explainer
    )
    expect(sheet).toHaveAccessibleDescription(explainer)
    await user.keyboard('{Escape}')
    expect(sheet).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
