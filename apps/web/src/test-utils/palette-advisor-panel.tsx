// Shared Story 5.4 `/palette` panel fixtures. Profiles are served through MSW, so
// the request shape, the bearer header and the contract parsing stay exercised.
import { I18nextProvider } from 'react-i18next'
import { http, HttpResponse } from 'msw'
import { render } from '@testing-library/react'
import {
  ADVISOR_RULES_VERSION,
  type AdvisorRecommendationCard,
  type PaletteAdvisorProfile,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../lib/wardrobe'
import { PaletteAdvisorPanel } from '../app/components/palette-advisor-panel'

export const PALETTE_PATH = '/api/v1/commerce/premium/palette'

export type ProfileOverrides = Partial<PaletteAdvisorProfile>

export function profile(overrides: ProfileOverrides = {}): PaletteAdvisorProfile {
  return {
    profileId: 'palette-profile-1',
    isEntitled: true,
    analysisEnabled: true,
    hasConsent: false,
    analysis: null,
    recommendations: [],
    ...overrides,
  } as PaletteAdvisorProfile
}

export function readyAnalysis(depth: 'medium' | null) {
  return {
    status: 'ready' as const,
    failureReason: null,
    source: depth === null ? ('wardrobe' as const) : ('selfie' as const),
    undertone: 'warm' as const,
    depth,
    confidence: 0.82,
    // The contract's own constant, not a copy of its current value: a rules
    // bump must not silently turn every ready-state fixture here into the
    // stale-palette case 5.4-WEB-043 owns.
    analysisVersion: ADVISOR_RULES_VERSION,
    analyzedAt: '2026-08-25T10:00:00.000Z',
  }
}

export function card(
  entry: { itemKey: string; labelKey: string; swatchHex: string },
  overrides: Partial<AdvisorRecommendationCard> = {}
): AdvisorRecommendationCard {
  return {
    slot: 'foundation',
    itemKey: entry.itemKey,
    labelKey: entry.labelKey,
    swatchHex: entry.swatchHex,
    saved: false,
    sponsored: null,
    ...overrides,
  }
}

export function getHandler(overrides: ProfileOverrides = {}) {
  return http.get(PALETTE_PATH, () => HttpResponse.json({ data: profile(overrides) }))
}

export function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

export function renderPanel() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <PaletteAdvisorPanel />
    </I18nextProvider>
  )
}

/** The shared `.strict()` error envelope, which is how every reason is classified. */
export function errorBody(statusCode: number, message: string, error: string) {
  return HttpResponse.json({ statusCode, message, error }, { status: statusCode })
}
