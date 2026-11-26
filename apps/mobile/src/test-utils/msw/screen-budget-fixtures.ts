// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): the native half of spec D1, for the four screen-budget suites
// (7.10-NAT-001..015). The same three members as the web shell fixtures
// (playwright/support/helpers/shell-fixtures.ts): `empty`, `populated` and `guardian-pending`.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
//
// Every body is parsed by its published contract schema before it is served, so a fixture that
// drifts from the wire shape fails at request time instead of measuring a screen the API never
// produces.
import { http, HttpResponse } from 'msw'
import type { z } from 'zod'
import {
  communityReactionFeedResponseSchema,
  communityReactionSpotlightResponseSchema,
  garmentListWireResponseSchema,
  listSavedLocationsResponseSchema,
  premiumAccessResponseSchema,
  premiumThemeResponseSchema,
  ritualResponseSchema,
  savedLookListResponseSchema,
  subscriptionResponseSchema,
  userProfileResponseSchema,
  wardrobeOnboardingStateResponseSchema,
} from '@couture/api-client/contracts/http'
import { mockRitualResponse } from './handlers'
import { server } from './server'

export const SCREEN_BUDGET_MODES = ['empty', 'populated', 'guardian-pending'] as const
export type ScreenBudgetMode = (typeof SCREEN_BUDGET_MODES)[number]

/** As many garments as the web populated closet, so both grids fill the fold the same way. */
export const SCREEN_BUDGET_GARMENTS = 24

const iso = '2026-11-20T12:00:00.000Z'
const pixel =
  'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%201%201%22%3E%3Cpath%20d=%22M0%200h1v1H0z%22%20fill=%22blue%22/%3E%3C/svg%3E'

const PNG_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** What the API answers a member with no saved city (the web fixture's NO_CITY). */
const NO_CITY = {
  statusCode: 400,
  message: 'No location preferences found for user',
  error: 'Bad Request',
}

function parsed<Schema extends z.ZodTypeAny>(schema: Schema, body: z.input<Schema>) {
  return HttpResponse.json(schema.parse(body) as unknown as Record<string, unknown>)
}

function feedItem(id: string, title: string) {
  return {
    id,
    title,
    caption: `${title}, for a cool day.`,
    altText: `Illustration of ${title.toLowerCase()}.`,
    climateBand: 'temperate_dry' as const,
    status: 'published' as const,
    challengeId: null,
    author: { isSelf: false, displayName: 'Fixture neighbor' },
    publishedAt: iso,
    createdAt: iso,
    // A PNG that expires an hour from the read, as storage signs it: the Community card refuses
    // an image reference outside the signing window (CI 2c27e80e: no card rendered).
    imageAccess: {
      url: PNG_PIXEL,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    // The app asks for reaction summaries (x-couture-reactions: 1) and the API sends one on every
    // item; without it the client drops the reaction rows CC-7.15 keeps on each card.
    reactions: {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      viewerReaction: null,
      revision: 0,
      generation: 0,
    },
  }
}

function garment(index: number) {
  return {
    id: `budget-garment-${index + 1}`,
    status: 'ready' as const,
    category: (['top', 'bottom', 'outerwear', 'shoes'] as const)[index % 4]!,
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: iso,
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: iso,
    committedAt: iso,
    imageAccess: { url: pixel, expiresAt: '2099-12-31T00:00:00.000Z' },
  } as const
}

/**
 * Serves every read the four tab screens make on mount for `mode`, on top of the default
 * handlers. Spec D1: `guardian-pending` is a 14 year old teen whose one linked guardian is still
 * `pending`. Under the production consent policy `off` the API lets that teen through on every
 * read, so the member's own reads answer as `empty` while the shared Community feed and
 * Spotlight answer as `populated`.
 */
export function serveScreenBudgetFixture(mode: ScreenBudgetMode, memberId: string) {
  const populated = mode === 'populated'
  const community = mode !== 'empty'
  const teenPending = mode === 'guardian-pending'
  const feedItems = community
    ? [feedItem('budget-look-1', 'Blue layers'), feedItem('budget-look-2', 'Rain shell')]
    : []

  server.use(
    http.get('*/api/v1/ritual', () =>
      populated
        ? parsed(ritualResponseSchema, mockRitualResponse)
        : HttpResponse.json(NO_CITY, { status: 400 })
    ),
    http.get('*/api/v1/locations', () =>
      parsed(listSavedLocationsResponseSchema, {
        data: populated
          ? [
              {
                id: 'budget-home',
                label: 'Chicago home',
                locationKey: 'chicago',
                latitude: 41.88,
                longitude: -87.63,
                timezone: 'America/Chicago',
                city: 'Chicago',
                region: 'Illinois',
                country: 'US',
                isPrimary: true,
                sortOrder: 0,
                createdAt: iso,
                updatedAt: iso,
              },
            ]
          : [],
      })
    ),
    http.get('*/api/v1/user/profile', () =>
      parsed(userProfileResponseSchema, {
        user: {
          id: memberId,
          email: 'budget-member@example.test',
          displayName: null,
          // 14 at the fixed clock (2026-11-20), inside the 13 to 15 consent band.
          birthdate: teenPending ? '2012-06-01T00:00:00.000Z' : null,
          role: teenPending ? 'teen' : 'guardian',
        },
        linkedGuardians: teenPending
          ? [
              {
                guardianId: 'budget-guardian-pending',
                status: 'pending',
                consentGrantedAt: null,
              },
            ]
          : [],
        linkedTeens: [],
      })
    ),
    http.get('*/api/v1/wardrobe/onboarding', () =>
      parsed(wardrobeOnboardingStateResponseSchema, {
        data: populated
          ? {
              status: 'completed',
              currentStep: 'complete',
              usedStarterWardrobe: false,
              garmentsCapturedCount: SCREEN_BUDGET_GARMENTS,
              startedAt: iso,
              completedAt: iso,
              revision: 4,
            }
          : {
              status: 'not_started',
              currentStep: 'permission',
              usedStarterWardrobe: false,
              garmentsCapturedCount: 0,
              startedAt: null,
              completedAt: null,
              revision: 0,
            },
      })
    ),
    http.get('*/api/v1/wardrobe/garments', () =>
      parsed(garmentListWireResponseSchema, {
        data: populated
          ? Array.from({ length: SCREEN_BUDGET_GARMENTS }, (_, index) => garment(index))
          : [],
      })
    ),
    http.get('*/api/v1/wardrobe/saved-looks', () =>
      parsed(savedLookListResponseSchema, {
        data: [],
        total: 0,
        limit: 50,
        offset: 0,
      })
    ),
    http.get('*/api/v1/commerce/subscription', () =>
      parsed(subscriptionResponseSchema, {
        data: populated
          ? {
              status: 'active',
              store: 'stripe',
              productId: 'premium_monthly',
              willRenew: true,
              currentPeriodEnd: '2099-12-12T00:00:00.000Z',
              syncedAt: iso,
              purchasesEnabled: true,
            }
          : {
              status: 'none',
              store: null,
              productId: null,
              willRenew: null,
              currentPeriodEnd: null,
              syncedAt: null,
              purchasesEnabled: true,
            },
      })
    ),
    http.get('*/api/v1/commerce/premium/access', () =>
      parsed(premiumAccessResponseSchema, {
        data: populated
          ? { premium: true, source: 'subscription' }
          : { premium: false, source: 'none' },
      })
    ),
    http.get('*/api/v1/commerce/premium/theme', () =>
      parsed(premiumThemeResponseSchema, {
        data: { theme: null, isEntitled: populated, themesEnabled: true },
      })
    ),
    http.get('*/api/v1/community/feed', () =>
      parsed(communityReactionFeedResponseSchema, {
        data: {
          items: feedItems,
          authorStates: [],
          nextCursor: null,
          mode: 'auto',
          viewerBand: 'temperate_dry',
          bandResolved: true,
          bandUnresolvedReason: null,
          experimentVariant: 'auto',
          activeChallenge: null,
        },
      })
    ),
    http.get('*/api/v1/community/spotlight', () =>
      parsed(communityReactionSpotlightResponseSchema, {
        data: community
          ? {
              level: 'city',
              label: 'Chicago',
              items: [{ ...feedItem('budget-spot-1', 'Spotlight look'), rank: 1 }],
              nextCursor: null,
            }
          : { level: 'none', label: null, items: [], nextCursor: null },
      })
    )
  )
}
