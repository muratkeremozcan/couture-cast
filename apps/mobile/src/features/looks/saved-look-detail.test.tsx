// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-020..022 for the native saved look screen
// (`saved-look/[savedLookId]`, D5). It names the look in the top bar, shows the missing,
// needs-review and photo-unavailable notices, and Remove with Undo returns to Saved with the
// filter the look was opened from (P10, T2). A gone or foreign id reads "This look is no longer
// saved" with no title and no image (P6); signed out it reads nothing. Reopen in Style this piece
// keeps the CC-7.2 rule (T3) and hands focus back (CC-7.11 D13). The behaviour moved here from
// the deleted Closet row's suite (saved-looks-row.test.tsx, CC-7.2 and 7.11-NAT-030..033).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import { SAMPLE_CATALOG, stylePieceAnchor, stylePieceLooks } from '@couture/utils'
import type * as ReactNativeModule from 'react-native'
import type * as SavedLooksModule from '@/src/lib/saved-looks'
import type * as WardrobeModule from '@/src/lib/wardrobe'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  dismissTo: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
  canGoBack: vi.fn(() => true),
}))
/** Every title the screen hands the root stack's AppTopBar, newest last. */
const stackTitles = vi.hoisted(() => [] as (string | undefined)[])
const routeParams = vi.hoisted(() => ({ current: {} as Record<string, string> }))

vi.mock('expo-router', async () => ({
  router: routerMock,
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      stackTitles.push(options?.title)
      return null
    },
  },
  useLocalSearchParams: () => routeParams.current,
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))
// CC-7.11 D13 native accessibility focus, as the deleted Closet row suite proved it.
// react-native-web's findNodeHandle always throws, so each node gets a stable fake tag; on web
// (every case but the native Reopen one) safeFindNodeHandle never asks for one.
const a11y = vi.hoisted(() => {
  const tags = new Map<unknown, number>()
  return {
    tagOf: (node: unknown) => {
      if (!tags.has(node)) tags.set(node, 300 + tags.size)
      return tags.get(node)!
    },
    setAccessibilityFocus: vi.fn(),
  }
})
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: (node: unknown) => (node ? a11y.tagOf(node) : null),
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: a11y.setAccessibilityFocus,
    },
  }
})
// The Style this piece editor Reopen opens reaches native Expo modules it never uses here.
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
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}))

const lib = vi.hoisted(() => ({
  deleteSavedLookFromMobile: vi.fn(),
  getSavedLookFromMobile: vi.fn(),
  notifyMobileSavedLooksChanged: vi.fn(),
  restoreSavedLookFromMobile: vi.fn(),
  listGarmentsFromMobile: vi.fn(),
}))
vi.mock('@/src/lib/saved-looks', async (importOriginal) => ({
  ...(await importOriginal<typeof SavedLooksModule>()),
  deleteSavedLookFromMobile: lib.deleteSavedLookFromMobile,
  getSavedLookFromMobile: lib.getSavedLookFromMobile,
  notifyMobileSavedLooksChanged: lib.notifyMobileSavedLooksChanged,
  restoreSavedLookFromMobile: lib.restoreSavedLookFromMobile,
}))
vi.mock('@/src/lib/wardrobe', async (importOriginal) => ({
  ...(await importOriginal<typeof WardrobeModule>()),
  listGarmentsFromMobile: lib.listGarmentsFromMobile,
}))

import SavedLookRoute from '@/app/saved-look/[savedLookId]'
import {
  getMobileTabBarHeight,
  resetMobileTabBarHeightForTests,
  resetNetworkStatusForTests,
  SaveFeedbackProvider,
  setMobileTabBarHeight,
} from '@/components/save-feedback'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { Platform } from 'react-native'
import { MobileSavedLookRequestError } from '@/src/lib/saved-looks'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { AppThemeProvider } from '@/src/theme/theme-context'
import { SavedLookDetailScreen } from './saved-look-detail'

const MEMBER = 'detail-member'
const TOKEN = 'detail-token'
/** A real 1x1 PNG: react-native-web's ImageLoader loads it with no network hop. */
const PNG_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
/** Bytes that are no PNG: ImageLoader fails to decode them, with no network hop. */
const BROKEN_PNG = 'data:image/png;base64,AAAA'

const ACTIVE_GARMENT: GarmentItemContract = {
  id: 'garment-1',
  status: 'ready',
  category: 'top',
  material: 'cotton',
  comfortRange: 'mild',
  tagsConfirmedAt: '2026-11-20T00:00:00.000Z',
  fileSizeBytes: 2048,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-11-20T00:00:00.000Z',
  committedAt: '2026-11-20T00:00:00.000Z',
  imageAccess: {
    url: 'https://photos.example.test/garment-1.png',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
}

/** A Style this piece look the editor rebuilds exactly, anchored on `ACTIVE_GARMENT`. */
function exactEditorLook(overrides: Partial<SavedLookContract> = {}): SavedLookContract {
  const selection = stylePieceAnchor(ACTIVE_GARMENT)!
  const generated = stylePieceLooks(selection, 'warm-rainy', SAMPLE_CATALOG).looks[0]!
  return {
    id: 'sl-m1',
    ownerUserId: MEMBER,
    source: 'style_piece',
    lookId: generated.recipe.lookId,
    weather: 'warm-rainy',
    title: 'Weekend layers',
    anchorGarmentId: ACTIVE_GARMENT.id,
    anchorSnapshot: {
      garmentId: ACTIVE_GARMENT.id,
      category: 'top',
      comfortRange: 'mild',
    },
    composition: [
      {
        slotIndex: 0,
        category: 'top',
        kind: 'garment',
        itemId: ACTIVE_GARMENT.id,
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
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: '2026-11-22T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
    ...overrides,
  }
}

/** The same look with its slots out of the editor's order: it stays in its detail (CC-7.2). */
function reorderedLook(): SavedLookContract {
  const base = exactEditorLook()
  return exactEditorLook({
    id: 'sl-reordered',
    composition: [
      base.composition[0]!,
      { ...base.composition[base.composition.length - 1]!, slotIndex: 1 },
      { ...base.composition[1]!, slotIndex: 2 },
    ],
  })
}

function renderDetail(
  savedLookId: string | undefined = 'sl-m1',
  from: 'all' | 'today' | 'capsules' | null = null
) {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <SavedLookDetailScreen savedLookId={savedLookId} from={from} />
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

describe('Saved look screen (native, Story CC-7.12 D5)', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    stackTitles.length = 0
    routeParams.current = {}
    routerMock.canGoBack.mockReturnValue(true)
    resetNetworkStatusForTests(true)
    restoreToken = setMobileAccessTokenResolver(() => TOKEN)
    setMobileApplicationUserId(MEMBER)
    lib.getSavedLookFromMobile.mockResolvedValue(exactEditorLook())
    lib.deleteSavedLookFromMobile.mockResolvedValue(undefined)
    lib.restoreSavedLookFromMobile.mockResolvedValue(exactEditorLook({ revision: 2 }))
    lib.listGarmentsFromMobile.mockResolvedValue([ACTIVE_GARMENT])
  })

  afterEach(() => {
    restoreToken?.()
    restoreToken = undefined
    setMobileApplicationUserId(null)
    resetNetworkStatusForTests(true)
    resetMobileTabBarHeightForTests()
    screenFocus.reset()
    vi.clearAllMocks()
  })

  it('[7.14-PIC-005] displays a dated Today look with an uncached private garment photo', async () => {
    const original = exactEditorLook()
    lib.getSavedLookFromMobile.mockResolvedValue(
      exactEditorLook({
        source: 'home_sample',
        title: 'Rain-ready look',
        anchorGarmentId: null,
        anchorSnapshot: null,
        lookId: 'today:2026-11-20:rec-1',
        weather: 'rain',
        wornOn: '2026-11-20',
        composition: [
          {
            ...original.composition[0]!,
            imageAccess: {
              url: 'https://photos.example.test/today.png',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
            },
          },
          ...original.composition.slice(1),
        ],
      })
    )
    renderDetail('sl-m1')
    const detail = await screen.findByTestId('saved-look-detail')
    expect(stackTitles.at(-1)).toBe('Rain-ready look')
    expect(detail.textContent).toMatch(/Rain.*From Today.*Nov 20, 2026/i)
    expect(detail.querySelector('img[data-cache-policy="none"]')).toHaveAttribute(
      'src',
      'https://photos.example.test/today.png'
    )
  })

  it('[P0] [7.12-NAT-020] reads the one look and names it in the top bar; the body has no heading of its own', async () => {
    renderDetail('sl-m1')
    // Loading first, untitled: no name can show before the read proves the look is this member's.
    expect(screen.getByTestId('saved-look-detail-loading')).toBeInTheDocument()
    expect(stackTitles.at(-1)).toBe('')

    const detail = await screen.findByTestId('saved-look-detail')
    expect(lib.getSavedLookFromMobile).toHaveBeenCalledTimes(1)
    expect(lib.getSavedLookFromMobile).toHaveBeenCalledWith('sl-m1', {
      signal: expect.any(AbortSignal),
    })
    expect(stackTitles.at(-1)).toBe('Weekend layers')
    expect(within(detail).queryByText('Weekend layers')).toBeNull()
    expect(within(detail).getByTestId('saved-look-detail-body')).toBeInTheDocument()
    expect(within(detail).getAllByTestId(/^saved-look-slot-/)).toHaveLength(
      exactEditorLook().composition.length
    )
    // CC-7.11's modal layer is gone: the detail is its own stack screen.
    expect(screen.queryByTestId('saved-look-detail-modal')).toBeNull()
    expect(screen.queryByTestId('layer-body')).toBeNull()
  })

  it('[P1] [7.12-NAT-020] an untitled look is named by its sample look', async () => {
    const sample = SAMPLE_CATALOG.looks[0]!
    lib.getSavedLookFromMobile.mockResolvedValue(
      exactEditorLook({ title: null, source: 'home_sample', lookId: sample.id })
    )
    renderDetail('sl-m1')
    await screen.findByTestId('saved-look-detail')
    const title = stackTitles.at(-1)
    expect(title).toBeTruthy()
    expect(title).not.toBe(sample.id)
    // A home sample look never reads the closet: only Style this piece looks reopen.
    expect(lib.listGarmentsFromMobile).not.toHaveBeenCalled()
    expect(screen.queryByTestId('saved-look-reopen')).toBeNull()
  })

  it.each([
    ['removed (404)', 404],
    ["another member's (403)", 403],
  ])(
    '[P0] [7.12-NAT-021] a %s look reads "This look is no longer saved", untitled, with no image',
    async (_case, status) => {
      lib.getSavedLookFromMobile.mockRejectedValue(
        new MobileSavedLookRequestError('Not found', status, 'SAVED_LOOK_NOT_FOUND')
      )
      renderDetail('sl-foreign')

      const gone = await screen.findByTestId('saved-look-detail-gone')
      expect(gone).toHaveTextContent('This look is no longer saved')
      expect(i18n.t('looks.detail.gone')).toBe('This look is no longer saved')
      // P6: the same answer for both, with no title, slot, image or Remove.
      expect(stackTitles.every((title) => title === '')).toBe(true)
      expect(screen.queryByTestId('saved-look-detail')).toBeNull()
      expect(screen.queryAllByTestId(/^saved-look-slot-/)).toEqual([])
      expect(document.querySelectorAll('img')).toHaveLength(0)
      expect(screen.queryByTestId('saved-look-detail-remove')).toBeNull()
      expect(screen.queryByTestId('saved-look-detail-retry')).toBeNull()
    }
  )

  it('[P1] [7.12-NAT-021] a screen opened with no id reads as gone and sends no read', () => {
    // Not renderDetail(undefined): an undefined argument takes its 'sl-m1' default.
    render(
      <AccessibilityAnnouncerProvider>
        <AppThemeProvider>
          <SaveFeedbackProvider>
            <SavedLookDetailScreen savedLookId={undefined} from={null} />
          </SaveFeedbackProvider>
        </AppThemeProvider>
      </AccessibilityAnnouncerProvider>
    )
    expect(screen.getByTestId('saved-look-detail-gone')).toHaveTextContent(
      'This look is no longer saved'
    )
    expect(lib.getSavedLookFromMobile).not.toHaveBeenCalled()
  })

  it('[P0] [7.12-NAT-021] signed out asks to sign in and reads nothing', async () => {
    setMobileApplicationUserId(null)
    renderDetail('sl-m1')

    const signIn = screen.getByTestId('saved-look-detail-sign-in')
    expect(signIn).toHaveTextContent(i18n.t('looks.detail.signIn'))
    await userEvent.click(within(signIn).getByTestId('saved-look-detail-sign-in-action'))
    expect(routerMock.push).toHaveBeenCalledExactlyOnceWith('/signin')
    expect(lib.getSavedLookFromMobile).not.toHaveBeenCalled()
    expect(stackTitles.every((title) => title === '')).toBe(true)
  })

  it('[P1] [7.12-NAT-021] a failed read offers Retry, which reads again', async () => {
    lib.getSavedLookFromMobile
      .mockRejectedValueOnce(new MobileSavedLookRequestError('Server error', 503))
      .mockResolvedValueOnce(exactEditorLook())
    renderDetail('sl-m1')

    const failed = await screen.findByTestId('saved-look-detail-error')
    expect(failed).toHaveTextContent(i18n.t('savedLooks.loadFailed'))
    await userEvent.click(within(failed).getByTestId('saved-look-detail-retry'))
    await screen.findByTestId('saved-look-detail')
    expect(lib.getSavedLookFromMobile).toHaveBeenCalledTimes(2)
  })

  it('[P0] [7.12-NAT-020] shows the missing piece, needs review and photo unavailable notices', async () => {
    lib.getSavedLookFromMobile.mockResolvedValueOnce(
      exactEditorLook({
        id: 'sl-missing',
        availabilityStatus: 'missing_garment',
        missingGarmentIds: ['garment-gone'],
        composition: [
          {
            slotIndex: 0,
            category: 'top',
            kind: 'garment',
            itemId: 'garment-gone',
            label: null,
            missing: true,
            imageAccess: null,
          },
          {
            slotIndex: 1,
            category: 'bottom',
            kind: 'garment',
            itemId: 'garment-expired',
            label: null,
            missing: false,
            imageAccess: {
              url: 'https://photos.example.test/expired.png',
              expiresAt: '2020-01-01T00:00:00.000Z',
            },
          },
        ],
      })
    )
    const missing = renderDetail('sl-missing')
    await screen.findByTestId('saved-look-detail')
    expect(screen.getByTestId('saved-look-detail-missing')).toHaveTextContent(
      i18n.t('savedLooks.missingPieceDetail')
    )
    expect(screen.getByTestId('saved-look-slot-0')).toHaveTextContent(
      i18n.t('savedLooks.missingPiece')
    )
    // An expired photo never loads: the placeholder and "Photo unavailable" show at once.
    expect(screen.getAllByTestId('saved-look-photo-placeholder')).toHaveLength(1)
    expect(screen.getByTestId('saved-look-slot-1')).toHaveTextContent(
      i18n.t('savedLooks.photoUnavailable')
    )
    expect(screen.queryByTestId('saved-look-detail-needs-review')).toBeNull()
    missing.unmount()

    lib.getSavedLookFromMobile.mockResolvedValueOnce(
      exactEditorLook({
        id: 'sl-review',
        availabilityStatus: 'needs_review',
        needsReviewReasons: ['comfort_range_changed'],
        composition: [
          {
            slotIndex: 0,
            category: 'top',
            kind: 'garment',
            itemId: 'garment-1',
            label: null,
            missing: false,
            imageAccess: { url: PNG_PIXEL, expiresAt: '2099-01-01T00:00:00.000Z' },
          },
          {
            slotIndex: 1,
            category: 'bottom',
            kind: 'garment',
            itemId: 'garment-broken',
            label: null,
            missing: false,
            imageAccess: { url: BROKEN_PNG, expiresAt: '2099-01-01T00:00:00.000Z' },
          },
        ],
      })
    )
    renderDetail('sl-review')
    await screen.findByTestId('saved-look-detail')
    expect(screen.getByTestId('saved-look-detail-needs-review')).toHaveTextContent(
      i18n.t('savedLooks.needsReviewDetail')
    )
    expect(screen.queryByTestId('saved-look-detail-missing')).toBeNull()
    // An unexpired photo that fails to load: react-native-web reports it through ImageLoader
    // (no DOM event drives that), and the placeholder takes its place. The live photo stays.
    const live = screen.getByTestId('saved-look-slot-0')
    const broken = screen.getByTestId('saved-look-slot-1')
    await waitFor(() =>
      expect(within(broken).getByTestId('saved-look-photo-placeholder')).toBeVisible()
    )
    expect(broken).toHaveTextContent(i18n.t('savedLooks.photoUnavailable'))
    expect(screen.getAllByTestId('saved-look-photo-placeholder')).toHaveLength(1)
    expect(within(live).queryByTestId('saved-look-photo-placeholder')).toBeNull()
    expect(live.querySelector('img')).not.toBeNull()
    expect(live).not.toHaveTextContent(i18n.t('savedLooks.photoUnavailable'))
  })

  it.each([
    [
      'a Saved tile with app history below',
      'today' as const,
      true,
      () => expect(routerMock.back).toHaveBeenCalledTimes(1),
    ],
    // Fable review P3: with nothing to step back to, Remove dismisses to Looks; a root-stack
    // replace would stack a second tab group.
    [
      'a Saved tile on a cold stack',
      'capsules' as const,
      false,
      () =>
        expect(routerMock.dismissTo).toHaveBeenCalledExactlyOnceWith({
          pathname: '/looks',
          params: { segment: 'saved', filter: 'capsules' },
        }),
    ],
    [
      'View or a deep link',
      null,
      true,
      () =>
        expect(routerMock.dismissTo).toHaveBeenCalledExactlyOnceWith({
          pathname: '/looks',
          params: { segment: 'saved', filter: 'all' },
        }),
    ],
  ])(
    '[P0] [7.12-NAT-022] Remove from %s deletes, returns to Saved and Undo restores',
    async (_entry, from, canGoBack, expectNavigation) => {
      routerMock.canGoBack.mockReturnValue(canGoBack)
      renderDetail('sl-m1', from)
      await screen.findByTestId('saved-look-detail')

      await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
      await waitFor(() =>
        expect(lib.deleteSavedLookFromMobile).toHaveBeenCalledExactlyOnceWith(
          'sl-m1',
          '"saved-look:sl-m1:0"',
          { accessToken: TOKEN }
        )
      )
      // The Looks feed reads again, and Saved shows with the filter the look came from.
      expect(lib.notifyMobileSavedLooksChanged).toHaveBeenCalledExactlyOnceWith(MEMBER)
      expectNavigation()
      expect(routerMock.replace).not.toHaveBeenCalled()
      if (from === null || !canGoBack) expect(routerMock.back).not.toHaveBeenCalled()
      else expect(routerMock.dismissTo).not.toHaveBeenCalled()
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        i18n.t('feedback.removed')
      )

      await userEvent.click(await screen.findByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(lib.restoreSavedLookFromMobile).toHaveBeenCalledExactlyOnceWith('sl-m1', {
          accessToken: TOKEN,
        })
      )
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          i18n.t('feedback.undone')
        )
      )
      expect(lib.notifyMobileSavedLooksChanged).toHaveBeenCalledTimes(2)
    }
  )

  it('[P1] [7.12-NAT-022] a failed Undo keeps Retry, which restores again', async () => {
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')

    // Failed Undo restore keeps a Retry so the member can recover the look.
    lib.restoreSavedLookFromMobile.mockRejectedValueOnce(new Error('503 temporary'))
    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    await userEvent.click(await screen.findByTestId('status-bar-action-undo'))
    await userEvent.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(lib.restoreSavedLookFromMobile).toHaveBeenCalledTimes(2))
  })

  it('[P1] [7.12-NAT-022] a failed Remove offers Retry and stays on the look', async () => {
    lib.deleteSavedLookFromMobile
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce(undefined)
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')

    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    const retry = await screen.findByTestId('status-bar-action-retry')
    // Nothing navigated: the member is still on the look and Remove is usable again.
    expect(routerMock.back).not.toHaveBeenCalled()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(lib.notifyMobileSavedLooksChanged).not.toHaveBeenCalled()
    expect(screen.getByTestId('saved-look-detail-remove')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await userEvent.click(retry)
    await screen.findByTestId('status-bar-action-undo')
    expect(lib.deleteSavedLookFromMobile).toHaveBeenCalledTimes(2)
    expect(routerMock.back).toHaveBeenCalledTimes(1)
  })

  it('[P1] [7.12-NAT-022] a Remove the server already applied (404) shows Removed with no Undo', async () => {
    lib.deleteSavedLookFromMobile.mockRejectedValueOnce(
      new MobileSavedLookRequestError('Not found', 404, 'SAVED_LOOK_NOT_FOUND')
    )
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')

    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        i18n.t('feedback.removed')
      )
    )
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
    expect(lib.notifyMobileSavedLooksChanged).toHaveBeenCalledExactlyOnceWith(MEMBER)
    expect(routerMock.back).toHaveBeenCalledTimes(1)
  })

  it('[P1] [7.12-NAT-022] offline, Undo sends nothing and says it is offline; the removed look offers no second Remove', async () => {
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')

    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    const undo = await screen.findByTestId('status-bar-action-undo')
    // The look is gone and the screen is leaving: its Remove stays disabled.
    expect(screen.getByTestId('saved-look-detail-remove')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    resetNetworkStatusForTests(false)
    await userEvent.click(undo)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        i18n.t('feedback.offlineAction')
      )
    )
    expect(lib.restoreSavedLookFromMobile).not.toHaveBeenCalled()
    expect(lib.deleteSavedLookFromMobile).toHaveBeenCalledTimes(1)
  })

  it('[P1] [7.12-NAT-022] offline, Remove sends nothing, says so, and stays on the look', async () => {
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')
    resetNetworkStatusForTests(false)

    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        i18n.t('feedback.offlineAction')
      )
    )
    expect(lib.deleteSavedLookFromMobile).not.toHaveBeenCalled()
    expect(routerMock.back).not.toHaveBeenCalled()
    expect(screen.getByTestId('saved-look-detail')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-detail-remove')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it("[P0] [7.12-NAT-022] [CC-7.7 D5] a member switch fences the previous member's Undo and a late Remove", async () => {
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')
    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    const undo = await screen.findByTestId('status-bar-action-undo')

    // The Undo bar outlives the screen. A switch takes A's notice off the shared bar (Codex TEA
    // review #3), and a late click on the Undo that was visible at the switch does nothing.
    act(() => setMobileApplicationUserId('member-b'))
    await waitFor(() => expect(screen.queryByTestId('status-bar-action-undo')).toBeNull())
    expect(screen.queryByTestId('status-feedback-bar')?.textContent ?? '').not.toContain(
      i18n.t('feedback.removed')
    )
    act(() => undo.click())
    expect(lib.restoreSavedLookFromMobile).not.toHaveBeenCalled()

    // A DELETE that settles after a switch reports nothing and navigates nowhere.
    act(() => setMobileApplicationUserId(MEMBER))
    await screen.findByTestId('saved-look-detail')
    let finishDelete!: () => void
    lib.deleteSavedLookFromMobile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve
        })
    )
    lib.notifyMobileSavedLooksChanged.mockClear()
    routerMock.back.mockClear()
    routerMock.replace.mockClear()
    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    await waitFor(() => expect(lib.deleteSavedLookFromMobile).toHaveBeenCalledTimes(2))

    act(() => setMobileApplicationUserId('member-b'))
    await act(async () => {
      finishDelete()
      await Promise.resolve()
    })
    expect(lib.notifyMobileSavedLooksChanged).not.toHaveBeenCalled()
    expect(routerMock.back).not.toHaveBeenCalled()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(routerMock.dismissTo).not.toHaveBeenCalled()
  })

  it('[P1] [7.12-NAT-022] [Codex TEA review #3] the same member back on Saved keeps Undo, and it restores', async () => {
    const view = renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')
    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
    await screen.findByTestId('status-bar-action-undo')

    // Remove returned to Saved: the detail is gone and the shared bar stays.
    view.rerender(
      <AccessibilityAnnouncerProvider>
        <AppThemeProvider>
          <SaveFeedbackProvider>
            <></>
          </SaveFeedbackProvider>
        </AppThemeProvider>
      </AccessibilityAnnouncerProvider>
    )
    expect(screen.queryByTestId('saved-look-detail')).toBeNull()
    // The same identity published again is no switch.
    act(() => setMobileApplicationUserId(MEMBER))

    const undo = screen.getByTestId('status-bar-action-undo')
    expect(undo).toBeVisible()
    await userEvent.click(undo)
    await waitFor(() =>
      expect(lib.restoreSavedLookFromMobile).toHaveBeenCalledExactlyOnceWith('sl-m1', {
        accessToken: TOKEN,
      })
    )
  })

  it('[P1] [7.12-NAT-020] [TEA T3] an exact Style this piece look reopens in the editor, and focus returns to Reopen', async () => {
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')
    // Reopen waits for the closet read that holds the anchor piece.
    await waitFor(() =>
      expect(lib.listGarmentsFromMobile).toHaveBeenCalledWith(
        TOKEN,
        expect.any(AbortSignal)
      )
    )
    const reopen = await screen.findByTestId('saved-look-reopen')

    await userEvent.click(reopen)
    const panel = await screen.findByTestId('style-piece-panel')
    await userEvent.click(within(panel).getByTestId('style-piece-close'))
    await waitFor(() => expect(screen.queryByTestId('style-piece-panel')).toBeNull())
    await waitFor(() => expect(reopen).toHaveFocus())
    // Web moves DOM focus; it never asks for a native handle.
    expect(a11y.setAccessibilityFocus).not.toHaveBeenCalled()
  })

  it('[P1] [7.11-NAT-031] [TEA T3] on native, closing the reopened editor hands accessibility focus to the Reopen handle', async () => {
    renderDetail('sl-m1', 'all')
    await screen.findByTestId('saved-look-detail')
    const reopen = await screen.findByTestId('saved-look-reopen')
    await userEvent.click(reopen)
    const panel = await screen.findByTestId('style-piece-panel')
    a11y.setAccessibilityFocus.mockClear()

    // focusStylePieceControl branches on the platform when it runs, after the editor is gone.
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    try {
      await userEvent.click(within(panel).getByTestId('style-piece-close'))
      await waitFor(() => expect(screen.queryByTestId('style-piece-panel')).toBeNull())
      await waitFor(() =>
        expect(a11y.setAccessibilityFocus).toHaveBeenLastCalledWith(a11y.tagOf(reopen))
      )
    } finally {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    }
  })

  it('[P1] [7.12-NAT-020] [TEA T3] a look out of the editor order, or whose anchor left the closet, stays in its detail', async () => {
    lib.getSavedLookFromMobile.mockResolvedValueOnce(reorderedLook())
    const reordered = renderDetail('sl-reordered')
    await screen.findByTestId('saved-look-detail')
    await waitFor(() => expect(lib.listGarmentsFromMobile).toHaveBeenCalled())
    await act(async () => {
      await lib.listGarmentsFromMobile.mock.results.at(-1)!.value
    })
    expect(screen.queryByTestId('saved-look-reopen')).toBeNull()
    reordered.unmount()

    lib.listGarmentsFromMobile.mockResolvedValue([])
    renderDetail('sl-m1')
    await screen.findByTestId('saved-look-detail')
    await waitFor(() => expect(lib.listGarmentsFromMobile).toHaveBeenCalledTimes(2))
    await act(async () => {
      await lib.listGarmentsFromMobile.mock.results.at(-1)!.value
    })
    expect(screen.queryByTestId('saved-look-reopen')).toBeNull()
    // Remove still works for a look that cannot reopen.
    expect(screen.getByTestId('saved-look-detail-remove')).toBeInTheDocument()
  })

  it('[P1] [7.12-NAT-020] the route reads its id and origin filter, and clears the tab bar clearance while shown', async () => {
    setMobileTabBarHeight(64)
    routeParams.current = { savedLookId: 'sl-m1', from: 'today' }
    routerMock.canGoBack.mockReturnValue(true)
    const view = render(
      <AccessibilityAnnouncerProvider>
        <AppThemeProvider>
          <SaveFeedbackProvider>
            <SavedLookRoute />
          </SaveFeedbackProvider>
        </AppThemeProvider>
      </AccessibilityAnnouncerProvider>
    )
    await screen.findByTestId('saved-look-detail')
    expect(lib.getSavedLookFromMobile).toHaveBeenCalledWith('sl-m1', expect.anything())
    // The stack screen covers the tab bar, so the status bar sits on the safe area.
    expect(getMobileTabBarHeight()).toBe(0)

    // `from` came from a Saved tile, so Remove steps back to that page.
    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
    expect(routerMock.replace).not.toHaveBeenCalled()

    view.unmount()
    expect(getMobileTabBarHeight()).toBe(64)
  })
})
