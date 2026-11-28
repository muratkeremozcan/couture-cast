// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.11 test owner (TEA): 7.11-BUD-001 (the native Looks tab joins the CC-7.10 screen
// budget, measured under the empty, populated and guardian-pending members, its `looksAnchors`
// first content rendered) and 7.11-NAT-010 and 040 (Looks' first content inside the 360 x 640
// fold, every fixture).
// Story CC-7.12 test owner (TEA): 7.12-BUD-002 (the budget measures each segment, Saved, Ideas and
// Plan, under every fixture, D13) and 7.12-NAT-010 (each segment's `looks-first-content` inside
// the 360 x 640 band below the 56 pt top bar and above the tab bar, CC-7.11 P4; only the segment
// and filter labels come before it; a free member's Plan Upgrade sits inside the band, TEA P4).
// 7.11-NAT-014 (the Capsules and Plan rows) became the segments: those rows are gone (D1, D6).
// The populated member has one saved look and one capsule a day older, as the web shell fixture.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import { screenBudget } from '@couture/utils'
import React from 'react'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
}))
/** The `looks` tab params each case opens on. */
const tabParams = vi.hoisted(() => ({ current: {} as Record<string, string> }))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => ({
  router: routerMock,
  useLocalSearchParams: () => tabParams.current,
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
// AppTopBar and the Manage capsules chevron import the icon font, whose native module the
// browser lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))

import {
  outfitCapsuleListResponseSchema,
  plannerResponseSchema,
  savedLookListResponseSchema,
  type PlannerReadyDay,
} from '@couture/api-client/contracts/http'
import LooksRoute from '@/app/(tabs)/looks'
import { SaveFeedbackProvider } from '@/components/save-feedback'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AppThemeProvider } from '@/src/theme/theme-context'
import { AppTopBar } from '@/src/components/app-top-bar'
import {
  WithFoldScene,
  chromeBefore,
  expectFirstContentInFold,
  foldBand,
  setFoldViewport,
  textBefore,
} from '@/src/test-utils/fold-band'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { server } from '@/src/test-utils/msw/server'
import {
  SCREEN_BUDGET_MODES,
  serveScreenBudgetFixture,
  type ScreenBudgetMode,
} from '@/src/test-utils/msw/screen-budget-fixtures'
import {
  WithTabHeader,
  expectNativeMeasureFloors,
  expectNativeWithinBudget,
  measureNativeScreen,
  setBudgetViewport,
} from '@/src/test-utils/screen-budget'

const MEMBER = 'budget-member'
const SAVED_LOOK_ID = 'budget-saved-look-1'
const CAPSULE_ID = 'budget-capsule-1'
const iso = '2026-11-20T12:00:00.000Z'
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const SEGMENTS = ['saved', 'ideas', 'plan'] as const
type Segment = (typeof SEGMENTS)[number]

/** The web shell fixture's saved look (playwright/support/helpers/shell-fixtures.ts). */
function savedLook() {
  return {
    id: SAVED_LOOK_ID,
    ownerUserId: MEMBER,
    source: 'home_sample' as const,
    lookId: 'office-oxford',
    weather: 'mild-dry' as const,
    title: null,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: (
      [
        ['top', 'oxford-shirt'],
        ['bottom', 'dark-jeans'],
        ['shoes', 'loafers'],
      ] as const
    ).map(([category, itemId], slotIndex) => ({
      slotIndex,
      category,
      kind: 'catalog' as const,
      itemId,
      label: null,
      missing: false,
      imageAccess: null,
    })),
    swaps: {},
    collection: 'all' as const,
    comfort: {
      runsColdWarm: 'neutral' as const,
      windTolerance: 'medium' as const,
      precipPreparedness: 'medium' as const,
    },
    availabilityStatus: 'ready' as const,
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: iso,
    updatedAt: iso,
  }
}

/** The web shell fixture's capsule, saved a day before the look. */
function savedCapsule() {
  const created = '2026-11-19T12:00:00.000Z'
  return {
    id: CAPSULE_ID,
    ownerUserId: MEMBER,
    name: 'Office week',
    description: null,
    occasions: ['work' as const],
    isFavorite: false,
    revision: 0,
    availabilityStatus: 'ready' as const,
    unavailableGarmentCount: 0,
    garments: [0, 1].map((index) => ({
      id: `budget-garment-${index + 1}`,
      category: (['top', 'bottom'] as const)[index]!,
      material: 'cotton' as const,
      comfortRange: 'mild' as const,
      imageAccess: { url: pixel, expiresAt: '2099-12-31T00:00:00.000Z' },
      availabilityStatus: 'ready' as const,
      garmentOrder: index,
    })),
    createdAt: created,
    updatedAt: created,
  }
}

/** The entitled (populated) member's planner week: seven ready days from 2026-11-20. */
function plannerWeek() {
  const days: PlannerReadyDay[] = Array.from({ length: 7 }, (_, index) => ({
    status: 'ready',
    planDate: `2026-11-${String(20 + index).padStart(2, '0')}`,
    version: 1,
    weather: {
      confidence: 'hourly',
      freshness: 'fresh',
      condition: 'clear',
      temperatureLow: 12,
      temperatureHigh: 20,
    },
    isStarterWardrobe: false,
    outfits: (['morning', 'midday', 'evening'] as const).map((scenario) => ({
      id: `outfit-${index}-${scenario}`,
      scenario,
      garmentIds: ['budget-garment-1'],
      reasoningBadges: [],
      comfortNotes: `${scenario} comfort notes`,
      capsuleId: null,
      capsuleName: null,
      autoFilledGarmentIds: [],
      displayGarments: [{ id: 'budget-garment-1', category: 'top', imageAccess: null }],
      shopThisLook: null,
    })),
  }))
  return plannerResponseSchema.parse({
    data: {
      locationId: 'budget-home',
      timezone: 'America/Chicago',
      anchorDate: days[0]!.planDate,
      daysReady: 7,
      days,
    },
  })
}

/**
 * The fixture's reads, plus what Looks reads on top: the populated member's one saved look and
 * one capsule (the shared native fixture serves no saved look and no capsules read), and the
 * planner, which only the entitled populated member may read.
 */
function serveLooksFixture(fixture: ScreenBudgetMode) {
  serveScreenBudgetFixture(fixture, MEMBER)
  const populated = fixture === 'populated'
  server.use(
    http.get('*/api/v1/wardrobe/saved-looks', () =>
      HttpResponse.json(
        savedLookListResponseSchema.parse({
          data: populated ? [savedLook()] : [],
          total: populated ? 1 : 0,
          limit: 50,
          offset: 0,
        }) as unknown as Record<string, unknown>
      )
    ),
    http.get('*/api/v1/wardrobe/:ownerUserId/capsules', () =>
      HttpResponse.json(
        outfitCapsuleListResponseSchema.parse({
          data: populated ? [savedCapsule()] : [],
          total: populated ? 1 : 0,
          limit: 50,
          offset: 0,
        }) as unknown as Record<string, unknown>
      )
    ),
    http.get('*/api/v1/commerce/premium/planner', () =>
      populated
        ? HttpResponse.json(plannerWeek() as unknown as Record<string, unknown>)
        : HttpResponse.json(
            {
              statusCode: 403,
              message: 'Premium subscription required.',
              error: 'Forbidden',
            },
            { status: 403 }
          )
    )
  )
}

/** Looks under its tab top bar (Looks declares no trailing control), inside the providers. */
function renderLooks(
  Frame: React.ComponentType<{ header: React.ReactNode; children: React.ReactNode }>
) {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <Frame header={<AppTopBar title={i18n.t('tabs.looks')} />}>
            <LooksRoute />
          </Frame>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/** The gate is open on `segment` and its first content shows what that segment opens with. */
async function looksSettled(fixture: ScreenBudgetMode, segment: Segment) {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  await waitFor(() =>
    expect(screen.getByTestId(`looks-segment-${segment}`)).toHaveAttribute(
      'aria-selected',
      'true'
    )
  )
  const first = await screen.findByTestId('looks-first-content')
  if (segment === 'saved') {
    if (fixture === 'populated')
      await waitFor(() =>
        expect(
          within(first).getByTestId(`saved-look-card-${SAVED_LOOK_ID}`)
        ).toBeVisible()
      )
    else
      await waitFor(() =>
        expect(within(first).getByTestId('looks-filter-empty')).toBeVisible()
      )
  }
  if (segment === 'ideas')
    await waitFor(() =>
      expect(within(first).getByTestId('member-lookbook')).toBeVisible()
    )
  if (segment === 'plan') {
    if (fixture === 'populated')
      await waitFor(() =>
        expect(first.querySelector('[data-testid^="planner-day-"]')).not.toBeNull()
      )
    else
      await waitFor(() =>
        expect(within(first).getByTestId('plan-free-preview')).toBeVisible()
      )
  }
  return first
}

/** The segment labels, and on Saved the filter labels: the only text above the first content. */
function controlLabels(segment: Segment) {
  const labels = SEGMENTS.map((id) => i18n.t(`looks.segments.${id}`))
  if (segment === 'saved')
    labels.push(
      ...['all', 'today', 'capsules'].map((id) => i18n.t(`looks.filters.${id}`))
    )
  return labels
}

describe('Screen budget and first content: native Looks', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    await setBudgetViewport()
    tabParams.current = {}
    restoreToken = setMobileAccessTokenResolver(() => 'member-token')
    setMobileApplicationUserId(MEMBER)
  })

  afterEach(() => {
    restoreToken?.()
    restoreToken = undefined
    setMobileApplicationUserId(null)
    screenFocus.reset()
    vi.clearAllMocks()
  })

  it('[P0] [7.11-BUD-001] [7.12-BUD-002] the budget audits Looks with its own first-content anchor and tile selectors', () => {
    expect(screenBudget.screens).toContain('looks')
    expect(screenBudget.fixtures).toEqual(['empty', 'populated', 'guardian-pending'])
    expect(screenBudget.selectors.native.looksAnchors).toEqual([
      '[data-testid="looks-first-content"]',
    ])
    expect(screenBudget.tabBarSelectors.native).toContain('[data-testid="tab-looks"]')
    // D13: the new tiles count as tiles, not as targets.
    expect(screenBudget.tileSelectors.native).toEqual(
      expect.arrayContaining([
        '[data-testid^="saved-look-card-"]',
        '[data-testid^="looks-capsule-card-"]',
        '[data-testid^="looks-idea-card-"]',
      ])
    )
  })

  for (const fixture of SCREEN_BUDGET_MODES)
    for (const segment of SEGMENTS)
      it(`[P0] [7.12-BUD-002] native looks ${segment} (${fixture}) is within the screen budget`, async () => {
        tabParams.current = { segment }
        serveLooksFixture(fixture)
        renderLooks(WithTabHeader)
        const first = await looksSettled(fixture, segment)

        const measurement = await measureNativeScreen('looks')
        expectNativeMeasureFloors(measurement, 'looks')
        // The checked-in anchor renders once and is the open segment's first content.
        const anchors = screenBudget.selectors.native.looksAnchors.flatMap((selector) =>
          Array.from(document.querySelectorAll(selector))
        )
        expect(anchors, 'one rendered native Looks anchor').toEqual([first])
        expect(first.getBoundingClientRect().top).toBeLessThan(
          screenBudget.measure.viewport.height
        )
        const targets = measurement.targetsAboveFold.map((target) => target.key)
        // D1: the three segments are counted targets on every segment.
        expect(targets).toEqual(
          expect.arrayContaining([
            'looks-segment-saved',
            'looks-segment-ideas',
            'looks-segment-plan',
          ])
        )
        // The CC-7.11 rows are gone (D1, D6).
        expect(targets).not.toContain('looks-capsules-row')
        expect(targets).not.toContain('looks-plan-row')
        // The member lookbook and free Plan each expose one primary action.
        const free = segment === 'plan' && fixture !== 'populated'
        const primary =
          segment === 'ideas' ? ['lookbook-save'] : free ? ['plan-upgrade'] : []
        expect(
          measurement.primaryButtons.map((button) => button.key),
          'primary buttons'
        ).toEqual(primary)
        expectNativeWithinBudget('looks', fixture, measurement)
      }, 30_000)

  for (const fixture of SCREEN_BUDGET_MODES)
    for (const segment of SEGMENTS)
      it(`[P0] [7.12-NAT-010] [7.11-NAT-0${fixture === 'guardian-pending' ? '40' : '10'}] native looks ${segment} (${fixture}) opens on its first content inside the 360 x 640 fold`, async () => {
        await setFoldViewport()
        tabParams.current = { segment }
        serveLooksFixture(fixture)
        renderLooks(WithFoldScene)
        const first = await looksSettled(fixture, segment)

        expectFirstContentInFold(first, `Looks ${segment} first content`)
        expect(chromeBefore(first), 'banners, alerts or setup before Looks').toEqual([])
        // Only the segment control (and Saved's filter chips) sit between the bar and the content.
        const labels = controlLabels(segment)
        expect(
          textBefore(first).filter((text) => !labels.includes(text)),
          'text before Looks'
        ).toEqual([])

        if (segment === 'saved' && fixture === 'populated') {
          // The first tile shows whole inside the band (AC6).
          const tile = within(first).getByTestId(`saved-look-card-${SAVED_LOOK_ID}`)
          const band = foldBand()
          const box = tile.getBoundingClientRect()
          expect(box.top).toBeGreaterThanOrEqual(band.top - 1)
          expect(box.bottom).toBeLessThanOrEqual(band.bottom + 1)
        }
        if (segment === 'plan' && fixture !== 'populated') {
          // TEA P4: a member who never scrolls sees what Premium adds and its one Upgrade.
          const upgrade = within(first).getByTestId('plan-upgrade')
          const band = foldBand()
          const box = upgrade.getBoundingClientRect()
          expect(box.top, 'Upgrade top').toBeGreaterThanOrEqual(band.top - 1)
          expect(box.bottom, 'Upgrade bottom inside the band').toBeLessThanOrEqual(
            band.bottom + 1
          )
          expect(box.height).toBeGreaterThanOrEqual(44)
        }
      }, 30_000)

  it('[P1] [7.12-NAT-001] (was 7.11-NAT-014) with no segment, the populated member opens Saved: the look, then the capsule, no rows', async () => {
    serveLooksFixture('populated')
    renderLooks(WithTabHeader)
    const first = await looksSettled('populated', 'saved')

    const grid = within(first).getByTestId('looks-saved-grid')
    const tiles = Array.from(
      grid.querySelectorAll(
        '[data-testid^="saved-look-card-"], [data-testid^="looks-capsule-card-"]'
      )
    ).map((tile) => tile.getAttribute('data-testid'))
    expect(tiles).toEqual([
      `saved-look-card-${SAVED_LOOK_ID}`,
      `looks-capsule-card-${CAPSULE_ID}`,
    ])
    // D1, D6: Capsules is a filter and Plan a segment; the CC-7.11 rows and list are gone.
    expect(screen.queryByTestId('looks-capsules-row')).toBeNull()
    expect(screen.queryByTestId('looks-plan-row')).toBeNull()
    expect(screen.queryByTestId('closet-saved-looks-list')).toBeNull()
    // The Reopen that sat in the CC-7.11 list lives on the saved look's screen now (D5, T3).
    expect(within(grid).queryByTestId('saved-look-reopen')).toBeNull()
    expect(routerMock.setParams).not.toHaveBeenCalled()
  })

  it('[P1] [7.12-NAT-001] (was 7.11-NAT-014) with no saved look, Looks opens on Ideas with one line', async () => {
    serveLooksFixture('empty')
    renderLooks(WithTabHeader)
    const first = await looksSettled('empty', 'ideas')

    const line = within(first).getByTestId('looks-ideas-empty-line')
    expect(line.textContent).toBe('Save a look to see it here')
    expect(i18n.t('looks.empty')).toBe('Save a look to see it here')
    expect(screen.queryByTestId('looks-capsules-row')).toBeNull()
    expect(screen.queryByTestId('looks-plan-row')).toBeNull()
  })

  it('[P1] [7.12-NAT-001] (was 7.11-NAT-014) signed out opens at once on Ideas and reads no saved look or capsule', async () => {
    restoreToken?.()
    restoreToken = setMobileAccessTokenResolver(() => undefined)
    setMobileApplicationUserId(null)
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/saved-looks', () => {
        reads += 1
        return HttpResponse.json({ data: [], total: 0, limit: 50, offset: 0 })
      }),
      http.get('*/api/v1/wardrobe/:ownerUserId/capsules', () => {
        reads += 1
        return HttpResponse.json({ data: [], total: 0, limit: 50, offset: 0 })
      })
    )
    renderLooks(WithTabHeader)

    const first = await screen.findByTestId('looks-first-content')
    expect(screen.getByTestId('looks-segment-ideas')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(within(first).getByTestId('looks-ideas-grid')).toBeVisible()
    expect(within(first).getByTestId('looks-ideas-empty-line')).toHaveTextContent(
      i18n.t('looks.empty')
    )
    // With no member there is nothing to read.
    expect(reads).toBe(0)
  })
})
