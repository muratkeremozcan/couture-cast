// The garment tile on the home outfit card must never show a garment id.
// A seeded wardrobe garment rendered as "Df7d0868 37fd 45e9 ..." because the
// tile title-cased whatever id it was given.
import { render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScenarioOutfit } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import { OutfitRecommendationCard } from './outfit-recommendation-card'
import { parseGarmentId } from './garment-item-tile'
import i18n, { initI18n } from '@/src/lib/i18n'

const WARDROBE_ID = 'df7d0868-37fd-45e9-b22e-f4d1cd69d5e4'

function outfit(overrides: Partial<ScenarioOutfit>): ScenarioOutfit {
  return {
    id: 'morning-outfit-id',
    scenario: 'morning',
    garmentIds: [],
    reasoningBadges: [],
    comfortNotes: 'Mild morning with gentle winds.',
    shopThisLook: null,
    ...overrides,
  }
}

function renderCard(value: ScenarioOutfit) {
  return render(<OutfitRecommendationCard outfit={value} onSwapGarment={vi.fn()} />)
}

describe('garment tile titles', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('labels a wardrobe garment by the category the API sent, never by its id', () => {
    renderCard(
      outfit({
        garmentIds: [WARDROBE_ID],
        displayGarments: [{ id: WARDROBE_ID, category: 'outerwear' }],
      })
    )

    const tile = screen.getByTestId(`garment-tile-${WARDROBE_ID}`)
    expect(tile.textContent).toContain('Outerwear')
    expect(tile.textContent).not.toMatch(/df7d0868/i)
    expect(tile.getAttribute('aria-label') ?? '').not.toMatch(/df7d0868/i)
  })

  it('falls back to a generic label for an id with no display data (cached payloads)', () => {
    renderCard(outfit({ garmentIds: [WARDROBE_ID] }))

    const tile = screen.getByTestId(`garment-tile-${WARDROBE_ID}`)
    expect(tile.textContent).toContain('Garment')
    expect(tile.textContent).not.toMatch(/df7d0868/i)
  })

  it('labels a starter placeholder by its slot category', () => {
    renderCard(outfit({ garmentIds: ['default-shoes'] }))

    expect(screen.getByTestId('garment-tile-default-shoes').textContent).toContain(
      'Shoes'
    )
  })

  it('keeps the readable name and localized group of a catalogue garment', async () => {
    await i18n.changeLanguage('fr-FR')
    renderCard(outfit({ garmentIds: ['classic-trench-coat'] }))

    const tile = screen.getByTestId('garment-tile-classic-trench-coat')
    expect(tile.textContent).toContain('Classic Trench Coat')
    expect(tile.textContent).not.toContain('Outerwear')
  })

  it('derives a name only from readable catalogue slugs', () => {
    expect(parseGarmentId('leather-belt').name).toBe('Leather Belt')
    expect(parseGarmentId(WARDROBE_ID).name).toBeNull()
    expect(parseGarmentId('clx3k9q2m0000abcd1234').name).toBeNull()
    expect(parseGarmentId('default-outerwear')).toEqual({
      name: null,
      category: 'Outerwear',
      wardrobeCategory: 'outerwear',
    })
  })
})
