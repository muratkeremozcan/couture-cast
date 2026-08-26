import type { PaletteAdvisorService } from '../../../../apps/api/src/modules/commerce/palette-advisor.service'
import {
  ADVISOR_RULES,
  ADVISOR_RULES_VERSION,
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  type PaletteAdvisorProfile,
  type UpdateAdvisorRecommendationInput,
} from '@couture/api-client/contracts/http'
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { getProviderPaletteAdvisorState } from '../state'

/**
 * Provider doubles for the palette advisor surface (Story 5.4).
 *
 * The shape follows `doubles/premium-theme.ts`: a scenario-driven double for the
 * service, with the real `PremiumEntitlementGuard` left un-mocked so a
 * `not-entitled` scenario produces the 403 the contract records rather than a
 * hand-written one.
 *
 * Two things are deliberately reproduced rather than simplified, because they are the
 * behaviours the contract exists to pin:
 *
 * - **Consent is checked before the flag.** `PALETTE_CONSENT_REQUIRED_MESSAGE` and
 *   `PALETTE_ANALYSIS_DISABLED_MESSAGE` are two different 403/503 answers, and their
 *   order (Decision 10) is what makes each observable. A double that checked the flag
 *   first would record a contract the server does not honour.
 * - **The `GET` never throws.** It answers for every scenario, carrying `isEntitled`,
 *   `analysisEnabled` and `hasConsent`, because a locked or kill-switched client still
 *   has a state to render.
 */
const PALETTE_PROFILE_ID = 'pact-palette-profile'
const PALETTE_ANALYZED_AT = '2026-08-25T10:00:00.000Z'
const PALETTE_UNDERTONE = 'warm' as const
const PALETTE_DEPTH = 'medium' as const

const READY_FOUNDATION =
  ADVISOR_RULES[PALETTE_UNDERTONE].foundation.withDepth[PALETTE_DEPTH]
const READY_JEWELRY = ADVISOR_RULES[PALETTE_UNDERTONE].jewelry

export function createPaletteAdvisorDoubles() {
  const scenarioOf = () =>
    getProviderPaletteAdvisorState()?.scenario ?? 'entitled-consented'

  const profileFor = (): PaletteAdvisorProfile => {
    const scenario = scenarioOf()
    const isEntitled = scenario !== 'not-entitled'
    const hasConsent =
      scenario === 'entitled-consented' || scenario === 'analysis-disabled'
    const isReady = scenario === 'entitled-consented'

    return {
      profileId: PALETTE_PROFILE_ID,
      isEntitled,
      analysisEnabled: scenario !== 'analysis-disabled',
      hasConsent,
      analysis: isReady
        ? {
            status: 'ready',
            failureReason: null,
            source: 'selfie',
            undertone: PALETTE_UNDERTONE,
            depth: PALETTE_DEPTH,
            confidence: 0.82,
            analysisVersion: ADVISOR_RULES_VERSION,
            analyzedAt: PALETTE_ANALYZED_AT,
          }
        : null,
      recommendations: isReady
        ? [
            {
              slot: 'foundation',
              itemKey: READY_FOUNDATION.itemKey,
              labelKey: READY_FOUNDATION.labelKey,
              swatchHex: READY_FOUNDATION.swatchHex,
              saved: false,
              sponsored: {
                partnerId: 'lumen-beauty',
                partnerDisplayName: 'Lumen Beauty',
                offerId: 'pact-advisor-offer',
                offerTitle: 'Lumen Skin Tint',
              },
            },
            {
              slot: 'jewelry',
              itemKey: READY_JEWELRY.itemKey,
              labelKey: READY_JEWELRY.labelKey,
              swatchHex: READY_JEWELRY.swatchHex,
              saved: false,
              sponsored: null,
            },
          ]
        : [],
    }
  }

  /** Decision 10's precedence, reproduced: consent first, then the kill switch. */
  const assertWritable = () => {
    const scenario = scenarioOf()
    if (scenario === 'entitled-no-consent') {
      throw new ForbiddenException(PALETTE_CONSENT_REQUIRED_MESSAGE)
    }
    if (scenario === 'analysis-disabled') {
      throw new ServiceUnavailableException(PALETTE_ANALYSIS_DISABLED_MESSAGE)
    }
  }

  const mockPaletteAdvisorService = {
    getProfile: () => Promise.resolve(profileFor()),
    setConsent: (_userId: string, granted: boolean) => {
      // The consent write is flag-gated but NOT consent-gated: it is how consent is
      // granted in the first place, so gating it on consent would make the feature
      // unreachable. `granted: false` runs the erase path, which answers a profile
      // with `hasConsent: false`.
      if (scenarioOf() === 'analysis-disabled') {
        throw new ServiceUnavailableException(PALETTE_ANALYSIS_DISABLED_MESSAGE)
      }
      return Promise.resolve(
        granted
          ? profileFor()
          : { ...profileFor(), hasConsent: false, analysis: null, recommendations: [] }
      )
    },
    analyzeWardrobe: () => {
      assertWritable()
      return Promise.resolve({
        ...profileFor(),
        analysis: {
          status: 'processing' as const,
          failureReason: null,
          source: 'wardrobe' as const,
          undertone: null,
          depth: null,
          confidence: null,
          analysisVersion: null,
          analyzedAt: null,
        },
        recommendations: [],
      })
    },
    updateRecommendation: (_userId: string, input: UpdateAdvisorRecommendationInput) => {
      const resolved = profileFor()
      return Promise.resolve({
        ...resolved,
        recommendations: resolved.recommendations
          // A dismissed card is omitted from the next read entirely (AC 6), which is
          // the single observable difference the recommendation contract records.
          .filter(
            (card) => !(card.itemKey === input.itemKey && input.action === 'dismissed')
          )
          .map((card) =>
            card.itemKey === input.itemKey
              ? { ...card, saved: input.action === 'saved' }
              : card
          ),
      })
    },
    erase: () =>
      Promise.resolve({
        ...profileFor(),
        hasConsent: false,
        analysis: null,
        recommendations: [],
      }),
  } as unknown as PaletteAdvisorService

  return { mockPaletteAdvisorService }
}
