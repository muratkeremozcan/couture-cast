// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-BUD-001 (the native Looks tab joins the CC-7.10 screen
// budget, measured under the empty, populated and guardian-pending members, its `looksAnchors`
// first content rendered), 7.11-NAT-010 and 040 (Looks' first content inside the 360 x 640 fold,
// nothing before it, every fixture) and 7.11-NAT-014 (saved looks first, then the Capsules and
// Plan rows; with no saved look one line, "Save a look to see it here", and the two rows).
// The populated member has one saved look, as the web shell fixture does. [Codex 7.11 #8]
// (D13): a Style this piece look reopened from the list returns focus to its Reopen on close.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import {
  SAMPLE_CATALOG,
  screenBudget,
  stylePieceAnchor,
  stylePieceLooks,
} from '@couture/utils'
import React from 'react'
import { userEvent } from 'vitest/browser'
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => ({
  router: routerMock,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
// AppTopBar and the Looks rows' chevrons import the icon font, whose native module the browser
// lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))
// The Style this piece editor a look reopens in reaches native Expo modules; the audit never
// opens it.
vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png' },
}))
vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    list() {
      return []
    }
  },
  File: class {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}/${name}` : uri
    }
    readonly exists = false
    readonly size = 0
    textSync() {
      return ''
    }
    write() {
      return undefined
    }
    delete() {
      return undefined
    }
    bytes() {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]))
    }
  },
  Paths: { cache: 'file:///cache/', document: 'file:///documents' },
}))
vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))
// Real reads; the focus case awaits the closet read the editor needs before it presses Reopen.
vi.mock('@/src/lib/wardrobe', { spy: true })

import {
  savedLookListResponseSchema,
  type SavedLookContract,
} from '@couture/api-client/contracts/http'
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { listGarmentsFromMobile } from '@/src/lib/wardrobe'
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
  setFoldViewport,
  textBefore,
} from '@/src/test-utils/fold-band'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { server } from '@/src/test-utils/msw/server'
import {
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
const iso = '2026-11-20T12:00:00.000Z'

const AUDITS: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.11-BUD-001', 'empty'],
  ['7.11-BUD-001', 'populated'],
  ['7.11-BUD-001', 'guardian-pending'],
]

const FOLD_CASES: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.11-NAT-010', 'empty'],
  ['7.11-NAT-010', 'populated'],
  ['7.11-NAT-040', 'guardian-pending'],
]

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

const STYLE_LOOK_ID = 'budget-style-piece-look'

/**
 * A Style this piece look the editor reopens exactly, anchored on the populated fixture's first
 * garment (`budget-garment-1`, a mild top): the anchor plus its generated companions.
 */
function stylePieceSavedLook(): SavedLookContract {
  const anchor = createReadyGarmentFixture({
    id: 'budget-garment-1',
    category: 'top',
    comfortRange: 'mild',
    imageAccess: {
      url: 'https://example.test/budget.png',
      expiresAt: '2099-12-31T00:00:00.000Z',
    },
  })
  const selection = stylePieceAnchor(anchor)!
  const generated = stylePieceLooks(selection, 'warm-rainy', SAMPLE_CATALOG).looks[0]!
  return savedLookListResponseSchema.parse({
    data: [
      {
        ...savedLook(),
        id: STYLE_LOOK_ID,
        source: 'style_piece',
        lookId: generated.recipe.lookId,
        weather: 'warm-rainy',
        anchorGarmentId: anchor.id,
        anchorSnapshot: {
          garmentId: anchor.id,
          category: selection.category,
          comfortRange: selection.comfortRange,
        },
        composition: [
          {
            slotIndex: 0,
            category: selection.category,
            kind: 'garment',
            itemId: anchor.id,
            label: null,
            missing: false,
            imageAccess: null,
          },
          ...generated.companions.map((companion, index) => ({
            slotIndex: index + 1,
            category: companion.category,
            kind: 'catalog' as const,
            itemId: companion.id,
            label: null,
            missing: false,
            imageAccess: null,
          })),
        ],
        swaps: generated.recipe.swaps,
        collection: null,
        comfort: null,
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  }).data[0]!
}

/**
 * The fixture's reads, plus the populated member's one saved look (the shared native fixture
 * serves no saved look, which the Closet's saved looks row below its grid never needed).
 */
function serveLooksFixture(fixture: ScreenBudgetMode) {
  serveScreenBudgetFixture(fixture, MEMBER)
  if (fixture !== 'populated') return
  server.use(
    http.get('*/api/v1/wardrobe/saved-looks', () =>
      HttpResponse.json(
        savedLookListResponseSchema.parse({
          data: [savedLook()],
          total: 1,
          limit: 50,
          offset: 0,
        }) as unknown as Record<string, unknown>
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

/** The Looks gate (the first saved looks page) is open and the list or the empty line shows. */
async function looksSettled(fixture: ScreenBudgetMode) {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  const first = await screen.findByTestId('looks-first-content')
  if (fixture === 'populated')
    await waitFor(() =>
      expect(within(first).getByTestId(`saved-look-card-${SAVED_LOOK_ID}`)).toBeVisible()
    )
  else await waitFor(() => expect(first).toBeVisible())
  return first
}

/** The Capsules and Plan rows, after the first content, in that order. */
function expectLooksRowsAfter(first: HTMLElement) {
  const capsules = screen.getByTestId('looks-capsules-row')
  const plan = screen.getByTestId('looks-plan-row')
  expect(capsules).toHaveTextContent(i18n.t('looks.capsules'))
  expect(plan).toHaveTextContent(i18n.t('looks.plan'))
  expect(capsules.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    first.getBoundingClientRect().bottom - 0.5
  )
  expect(plan.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    capsules.getBoundingClientRect().bottom - 0.5
  )
  return { capsules, plan }
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

  it('[P0] [7.11-BUD-001] the budget audits Looks with its own first-content anchor', () => {
    expect(screenBudget.screens).toContain('looks')
    expect(screenBudget.fixtures).toEqual(['empty', 'populated', 'guardian-pending'])
    expect(screenBudget.selectors.native.looksAnchors).toEqual([
      '[data-testid="looks-first-content"]',
    ])
    expect(screenBudget.tabBarSelectors.native).toContain('[data-testid="tab-looks"]')
  })

  for (const [id, fixture] of AUDITS) {
    it(`[P0] [${id}] native looks (${fixture}) is within the screen budget`, async () => {
      serveLooksFixture(fixture)
      renderLooks(WithTabHeader)
      const first = await looksSettled(fixture)

      const measurement = await measureNativeScreen('looks')
      expectNativeMeasureFloors(measurement, 'looks')
      // The checked-in anchor renders once and is the first content, above the fold.
      const anchors = screenBudget.selectors.native.looksAnchors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector))
      )
      expect(anchors, 'one rendered native Looks anchor').toEqual([first])
      expect(first.getBoundingClientRect().top).toBeLessThan(
        screenBudget.measure.viewport.height
      )
      // D8: Looks has no primary action of its own; its rows are counted targets.
      expect(measurement.primaryButtons).toEqual([])
      const targets = measurement.targetsAboveFold.map((target) => target.key)
      expect(targets).toEqual(
        expect.arrayContaining(['looks-capsules-row', 'looks-plan-row'])
      )
      expectNativeWithinBudget('looks', fixture, measurement)
    }, 30_000)
  }

  for (const [id, fixture] of FOLD_CASES) {
    it(`[P0] [${id}] native looks (${fixture}) opens on its own content inside the 360 x 640 fold`, async () => {
      await setFoldViewport()
      serveLooksFixture(fixture)
      renderLooks(WithFoldScene)
      const first = await looksSettled(fixture)

      expectFirstContentInFold(first, 'Looks first content')
      expect(chromeBefore(first), 'banners, alerts or setup before Looks').toEqual([])
      expect(textBefore(first), 'text before Looks').toEqual([])
      expectLooksRowsAfter(first)
    }, 30_000)
  }

  it('[P1] [7.11-NAT-014] lists the saved looks first, then Capsules and Plan, which open their screens', async () => {
    serveLooksFixture('populated')
    renderLooks(WithTabHeader)
    const first = await looksSettled('populated')

    // The saved looks list is the Looks content itself: open, with no toggle or count row.
    const list = within(first).getByTestId('closet-saved-looks-list')
    expect(within(list).getByTestId(`saved-look-card-${SAVED_LOOK_ID}`)).toBeVisible()
    expect(within(first).queryByTestId('closet-saved-looks-row')).toBeNull()
    expect(first).not.toHaveTextContent(i18n.t('looks.empty'))

    const { capsules, plan } = expectLooksRowsAfter(first)
    fireEvent.click(capsules)
    expect(routerMock.push).toHaveBeenLastCalledWith('/wardrobe-capsules')
    fireEvent.click(plan)
    expect(routerMock.push).toHaveBeenLastCalledWith('/planner')
    expect(routerMock.push).toHaveBeenCalledTimes(2)
  })

  it('[P1] [Codex 7.11 #8] [7.11-NAT-031] a look reopened in Style this piece returns focus to its Reopen when the editor closes', async () => {
    serveScreenBudgetFixture('populated', MEMBER)
    server.use(
      http.get('*/api/v1/wardrobe/saved-looks', () =>
        HttpResponse.json({
          data: [stylePieceSavedLook()],
          total: 1,
          limit: 50,
          offset: 0,
        })
      )
    )
    renderLooks(WithTabHeader)
    await looksSettled('empty')
    const card = await screen.findByTestId(`saved-look-card-${STYLE_LOOK_ID}`)
    // The editor needs the anchor piece: Reopen waits for the closet read to land.
    const reads = vi.mocked(listGarmentsFromMobile)
    await waitFor(() => expect(reads).toHaveBeenCalled())
    await act(async () => {
      await reads.mock.results.at(-1)!.value
    })
    const reopen = within(card).getByTestId('saved-look-reopen')

    await userEvent.click(reopen)
    const panel = await screen.findByTestId('style-piece-panel')
    // The editor took the press, not the look's detail layer.
    expect(screen.queryByTestId('saved-look-detail-modal')).toBeNull()
    await userEvent.click(within(panel).getByTestId('style-piece-close'))

    await waitFor(() => expect(screen.queryByTestId('style-piece-panel')).toBeNull())
    await waitFor(() => expect(reopen).toHaveFocus())
  })

  it('[P1] [7.11-NAT-014] with no saved look shows one line, then Capsules and Plan', async () => {
    serveLooksFixture('empty')
    renderLooks(WithTabHeader)
    const first = await looksSettled('empty')

    expect(first.textContent).toBe('Save a look to see it here')
    expect(i18n.t('looks.empty')).toBe('Save a look to see it here')
    expect(screen.queryByTestId('closet-saved-looks-list')).toBeNull()
    expectLooksRowsAfter(first)
  })

  it('[P1] [7.11-NAT-014] signed out opens at once on the empty line and both rows', async () => {
    restoreToken?.()
    restoreToken = setMobileAccessTokenResolver(() => undefined)
    setMobileApplicationUserId(null)
    let savedLookReads = 0
    server.use(
      http.get('*/api/v1/wardrobe/saved-looks', () => {
        savedLookReads += 1
        return HttpResponse.json({ data: [], total: 0, limit: 50, offset: 0 })
      })
    )
    renderLooks(WithTabHeader)

    const first = await looksSettled('empty')
    expect(first.textContent).toBe(i18n.t('looks.empty'))
    expectLooksRowsAfter(first)
    // With no member there is nothing to read.
    expect(savedLookReads).toBe(0)
  })
})
