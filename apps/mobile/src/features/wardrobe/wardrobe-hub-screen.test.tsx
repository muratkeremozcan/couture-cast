// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
// Learning path Step 63: Garment detail and tag edit (7.5-NAT-002, 7.5-NAT-006).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the Closet opens on its grid (D4, D5): Add and More sit in the
// tab top bar the hub fills through `navigation.setOptions`, so every render here draws that bar
// (`TabTopBar`) beside the hub. Setup and Silhouette moved into the More sheet, Capsules to Looks.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-024 (D8), the Closet renders no saved looks row and its
// gate waits on the inventory read alone: no saved looks list read, no Retry, no row on a return;
// device-saved looks still import from the Closet and the Looks feed hears of them; a saved look
// the editor could reopen no longer surfaces a Reopen here (the saved look screen owns it).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import React, { useEffect, useRef } from 'react'
import { userEvent as browserUser } from 'vitest/browser'
import type * as ReactNativeModule from 'react-native'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import { http, HttpResponse } from 'msw'
import type * as EdgeToEdgeModalModule from '@/components/edge-to-edge-modal'
import { setViewport } from '@/src/test-utils/viewport'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  setParams: vi.fn(),
}))
vi.mock('expo-router', async () => ({
  router: routerMock,
  // Story 7.6: the hub flushes pending deletes when its screen blurs; these cases stay focused.
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
  // Story CC-7.11 D4: the hub puts Add and More in its tab top bar through setOptions.
  useNavigation: (await import('../../test-utils/tab-navigation-store.js'))
    .useTabNavigation,
}))
// AppTopBar (drawn by TabTopBar) and the More sheet's X import the icon font, whose native
// module the browser lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))

const imagePicker = vi.hoisted(() => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-picker', () => imagePicker)

const nativeModalAccessibility = vi.hoisted(() => ({ enabled: false }))
const nativeStyleRuntime = vi.hoisted(() => ({
  enabled: false,
  platform: 'ios' as 'ios' | 'android',
  files: new Map<string, string>(),
  read: vi.fn<(uri: string) => void>(),
  focus: vi.fn<(target: number) => void>(),
  focusHandles: new Map([
    ['style-piece-open', 82],
    ['style-piece-refresh', 82],
    ['style-piece-close', 83],
    ['style-piece-weather-mild-dry', 84],
    ['style-piece-weather-cool-windy', 85],
    ['style-piece-weather-warm-rainy', 86],
  ]),
  /** Handles for controls with no testID (a failed garment's Replace), keyed by element. */
  nodeHandles: new Map<unknown, number>(),
  holdDismissal: false,
  finishDismissal: undefined as (() => void) | undefined,
  /**
   * Story CC-7.11 D13: when set, an opening Modal keeps its onShow in `finishShow` until the test
   * calls it, the way the native dialog reports onShow only once its slide-in ends.
   */
  holdShow: false,
  finishShow: undefined as (() => void) | undefined,
  state: 'active' as ReactNativeModule.AppStateStatus,
  stateListeners: new Set<(state: ReactNativeModule.AppStateStatus) => void>(),
}))
vi.mock('@/components/edge-to-edge-modal', async (importOriginal) => {
  const actual = await importOriginal<typeof EdgeToEdgeModalModule>()
  return {
    ...actual,
    underModalAccessibility: (open: boolean) => {
      if (!nativeModalAccessibility.enabled) return actual.underModalAccessibility(open)
      const props = actual.underModalAccessibility(open, 'ios')
      // Expose native hiding props to the web renderer used by this suite.
      return {
        ...props,
        'aria-hidden': props.accessibilityElementsHidden,
        dataSet: { importantForAccessibility: props.importantForAccessibility },
      }
    },
  }
})

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn().mockResolvedValue({
    uri: 'file:///cropped.png',
    width: 512,
    height: 512,
  }),
  SaveFormat: { PNG: 'png' },
}))

vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    list() {
      const prefix = `${this.uri}/`
      return Array.from(nativeStyleRuntime.files.keys())
        .filter((uri) => uri.startsWith(prefix))
        .map((uri) => ({ uri, name: uri.slice(prefix.length) }))
    }
  },
  File: class {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}/${name}` : uri
    }
    get exists() {
      return nativeStyleRuntime.files.has(this.uri)
    }
    get size() {
      return new TextEncoder().encode(nativeStyleRuntime.files.get(this.uri) ?? '').length
    }
    textSync() {
      nativeStyleRuntime.read(this.uri)
      return nativeStyleRuntime.files.get(this.uri) ?? ''
    }
    write(data: string) {
      nativeStyleRuntime.files.set(this.uri, data)
    }
    delete() {
      nativeStyleRuntime.files.delete(this.uri)
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

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return nativeStyleRuntime.enabled
          ? nativeStyleRuntime.platform
          : actual.Platform.OS
      },
    },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: nativeStyleRuntime.focus,
    },
    AppState: {
      get currentState() {
        return nativeStyleRuntime.enabled
          ? nativeStyleRuntime.state
          : actual.AppState.currentState
      },
      addEventListener: (
        event: ReactNativeModule.AppStateEvent,
        listener: (state: ReactNativeModule.AppStateStatus) => void
      ) => {
        if (!nativeStyleRuntime.enabled || event !== 'change')
          return actual.AppState.addEventListener(event, listener)
        nativeStyleRuntime.stateListeners.add(listener)
        return { remove: () => nativeStyleRuntime.stateListeners.delete(listener) }
      },
    },
    findNodeHandle: vi.fn((node: unknown) => {
      if (!nativeStyleRuntime.enabled || !(node instanceof HTMLElement)) return undefined
      return (
        nativeStyleRuntime.focusHandles.get(node.dataset.testid ?? '') ??
        nativeStyleRuntime.nodeHandles.get(node)
      )
    }),
    Modal: ({
      children,
      onDismiss,
      onShow,
      visible = true,
    }: {
      children: React.ReactNode
      onDismiss?: () => void
      onShow?: () => void
      visible?: boolean
    }) => {
      const wasVisible = useRef(false)
      const latestOnShow = useRef(onShow)
      latestOnShow.current = onShow
      useEffect(() => {
        const previous = wasVisible.current
        wasVisible.current = visible
        if (!nativeStyleRuntime.enabled || previous === visible) return
        if (visible) {
          // A held onShow calls the dialog's latest prop, as the native event would.
          if (nativeStyleRuntime.holdShow)
            nativeStyleRuntime.finishShow = () => latestOnShow.current?.()
          else onShow?.()
        } else if (nativeStyleRuntime.platform === 'ios') {
          if (nativeStyleRuntime.holdDismissal)
            nativeStyleRuntime.finishDismissal = onDismiss
          else onDismiss?.()
        }
      }, [onDismiss, onShow, visible])
      return visible ? children : null
    },
  }
})

import {
  createReadyGarmentFixture,
  createSuggestGarmentTagsDataFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { createSavedLooksMswHandlers } from '@/src/test-utils/saved-looks-msw'
import { subscribeMobileSavedLooksChanged } from '@/src/lib/saved-looks'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { press } from '@/src/test-utils/press'
import { notifyWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { TabTopBar, tabNavigation } from '@/src/test-utils/tab-navigation'
import { WardrobeHubScreen } from './wardrobe-hub-screen'
import {
  colorRoles,
  getGuestPreviewStrings,
  SAMPLE_CATALOG,
  stylePieceAnchor,
  stylePieceLooks,
} from '@couture/utils'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import { TAB_BODY_INSET } from '@/src/theme/tokens'

/** A `#RRGGBB` token as the browser's computed `rgb(r, g, b)`. */
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Base64url-shaped JWT payload, built at runtime (not a literal) so it
 * doesn't look like a credential to secret scanners; a hardcoded
 * JWT-shaped string here previously tripped gitleaks' generic-api-key rule
 * in CI.
 */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken('user-1')

function fixtureWardrobePhoto(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return {
    url: canvas.toDataURL('image/png'),
    expiresAt: '2099-12-31T00:00:00.000Z',
  }
}

/**
 * Story 7.5: the hub no longer prints raw garment ids, so a card is found by its testID and
 * an owner's wardrobe is told apart by the photo it shows (both owners share a garment id).
 */
async function expectCardPhoto(id: string, url: string) {
  await waitFor(() =>
    expect(screen.getByTestId(`garment-card-${id}`).querySelector('img')).toHaveAttribute(
      'src',
      url
    )
  )
  // Story CC-7.7: the card shows once the Closet gate's reads (inventory, onboarding) settle.
  await waitFor(() => expect(screen.getByTestId(`garment-card-${id}`)).toBeVisible())
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function changeNativeAppState(state: ReactNativeModule.AppStateStatus) {
  act(() => {
    nativeStyleRuntime.state = state
    for (const listener of nativeStyleRuntime.stateListeners) listener(state)
  })
}

const onboardingNotCompleted = {
  status: 'in_progress' as const,
  currentStep: 'capture' as const,
  usedStarterWardrobe: false,
  garmentsCapturedCount: 0,
  startedAt: '2026-08-09T00:00:00.000Z',
  completedAt: null,
  revision: 1,
}

/** The hub under its tab top bar, which carries Add and More (Story CC-7.11 D4). */
function renderHub(hub: React.ReactElement) {
  return render(
    <>
      <TabTopBar title={i18n.t('tabs.closet')} route="wardrobe" />
      {hub}
    </>
  )
}

function renderScreen(pollOffsetsMs: readonly number[] = [1, 1, 1, 1]) {
  // pollOffsetsMs keeps the still-processing garment poll deterministic and
  // fast in tests instead of paying the real 1s/2s/4s/8s production schedule.
  renderHub(<WardrobeHubScreen pollOffsetsMs={pollOffsetsMs} />)
}

const onboardingCompleted = {
  ...onboardingNotCompleted,
  status: 'completed' as const,
  currentStep: 'complete' as const,
  // `onboardingStateSchema` sets `completedAt` exactly when the status is `completed`.
  completedAt: '2026-08-09T00:10:00.000Z',
}

function garmentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'garment-1',
    status: 'awaiting_tags',
    category: null,
    material: null,
    comfortRange: null,
    tagsConfirmedAt: null,
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: '2026-08-09T00:00:00.000Z',
    committedAt: '2026-08-09T00:00:01.000Z',
    imageAccess: null,
    ...overrides,
  }
}

/** Drives the capture sheet until the commit response comes back. */
async function captureOneGarment() {
  imagePicker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///library-shot.png', width: 900, height: 900 }],
  })
  await waitFor(() => screen.getByTestId('garment-capture-open'))
  fireEvent.click(screen.getByTestId('garment-capture-open'))
  await waitFor(() => screen.getByTestId('garment-source-library'))
  fireEvent.click(screen.getByTestId('garment-source-library'))
  await waitFor(() => screen.getByTestId('garment-crop-preview'))
  fireEvent.click(screen.getByTestId('garment-confirm-image'))
  await waitFor(() => screen.getByTestId('garment-capture-complete'))
}

function captureUploadHandlers(garmentId: string, status: string) {
  return [
    http.post('*/api/v1/wardrobe/upload-url', () =>
      HttpResponse.json({
        data: {
          garmentId,
          uploadSessionId: 'session-1',
          uploadUrl: `${window.location.origin}/mock-storage/session-1`,
          uploadToken: 'upload-token-1',
          requiredHeaders: { 'content-type': 'image/png' },
          expiresAt: '2026-08-09T01:00:00.000Z',
        },
      })
    ),
    http.put('*/mock-storage/session-1', () => new HttpResponse(null, { status: 204 })),
    http.post('*/api/v1/wardrobe/garments', () =>
      HttpResponse.json({ data: garmentFixture({ id: garmentId, status }) })
    ),
  ]
}

describe('WardrobeHubScreen', () => {
  let restoreAccessTokenResolver: () => void
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => ACCESS_TOKEN)
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: onboardingNotCompleted })
      )
    )
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    }
    restoreAccessTokenResolver()
    setMobileApplicationUserId(null)
    nativeModalAccessibility.enabled = false
    nativeStyleRuntime.enabled = false
    nativeStyleRuntime.platform = 'ios'
    nativeStyleRuntime.files.clear()
    nativeStyleRuntime.read.mockReset()
    nativeStyleRuntime.nodeHandles.clear()
    nativeStyleRuntime.holdDismissal = false
    nativeStyleRuntime.finishDismissal = undefined
    nativeStyleRuntime.holdShow = false
    nativeStyleRuntime.finishShow = undefined
    nativeStyleRuntime.state = 'active'
    nativeStyleRuntime.stateListeners.clear()
    routerMock.replace.mockClear()
    routerMock.push.mockClear()
    tabNavigation.reset()
    vi.clearAllMocks()
  })

  it('[P1] [7.9 D6, D9] leaves the title to the tab header and names a garment status in words', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture()] })
      )
    )
    renderScreen()

    const status = await screen.findByTestId('garment-status-awaiting_tags')
    expect(status).toHaveTextContent('Waiting for tags')
    await waitFor(() => expect(screen.getByTestId('garment-capture-open')).toBeVisible())
    // The tab's AppTopBar shows the Wardrobe title; the body has no second one.
    expect(screen.queryByText(i18n.t('wardrobe.title'))).toBeNull()
  })

  it('7.7-NAT-003 [7.11 D4] the Closet gate waits for the inventory, never the onboarding read, then a refresh keeps the closet in place', async () => {
    let releaseOnboarding!: () => void
    const onboardingHeld = new Promise<void>((resolve) => {
      releaseOnboarding = resolve
    })
    onTestFinished(() => releaseOnboarding())
    let releaseInventory!: () => void
    const inventoryHeld = new Promise<void>((resolve) => {
      releaseInventory = resolve
    })
    onTestFinished(() => releaseInventory())
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', async () => {
        await onboardingHeld
        return HttpResponse.json({ data: onboardingNotCompleted })
      }),
      http.get('*/api/v1/wardrobe/garments', async () => {
        await inventoryHeld
        return HttpResponse.json({ data: [] })
      })
    )
    renderScreen()

    // The inventory has not answered: the placeholder holds.
    await waitFor(() => expect(screen.getByTestId('screen-placeholder')).toBeVisible())
    expect(screen.queryByText(i18n.t('wardrobe.empty_title'))).toBeNull()

    act(() => releaseInventory())

    // D4: the onboarding state only names the More sheet's setup row, so the closet opens with
    // that read still out, and nothing sits above the closet in the gate body.
    const emptyState = await screen.findByTestId('wardrobe-empty-state')
    await waitFor(() => expect(emptyState).toBeVisible())
    expect(screen.queryByTestId('screen-placeholder')).toBeNull()
    const body = screen.getByTestId('screen-gate-body-closet')
    expect(body.firstElementChild).toBe(emptyState)

    act(() => releaseOnboarding())
    await act(() => Promise.resolve())
    expect(body.firstElementChild).toBe(screen.getByTestId('wardrobe-empty-state'))

    // A refresh (a tag save elsewhere) never returns to the first-load spinner.
    let garmentReads = 0
    let releaseGarments!: () => void
    const garmentsHeld = new Promise<void>((resolve) => {
      releaseGarments = resolve
    })
    onTestFinished(() => releaseGarments())
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        garmentReads += 1
        await garmentsHeld
        return HttpResponse.json({ data: [] })
      })
    )
    act(() => notifyWardrobeChanged())
    await waitFor(() => expect(garmentReads).toBe(1))

    expect(screen.queryByLabelText('Loading wardrobe')).toBeNull()
    await waitFor(() =>
      expect(screen.getByText(i18n.t('wardrobe.empty_title'))).toBeVisible()
    )
    expect(body.firstElementChild).toBe(screen.getByTestId('wardrobe-empty-state'))
    expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  })

  // Replaces 7.7-NAT-004 "the gate waits for the first Saved Looks page": CC-7.12 D8 took saved
  // looks off the Closet, so a saved looks list that never answers holds nothing back.
  it('[P1] [7.12-NAT-024] 7.7-NAT-004 the Closet gate opens on the inventory read alone and reads no saved looks', async () => {
    setMobileApplicationUserId('closet-gate-saved-looks-owner')
    let savedLookReads = 0
    let releaseSavedLooks!: () => void
    const savedLooksHeld = new Promise<void>((resolve) => {
      releaseSavedLooks = resolve
    })
    onTestFinished(() => releaseSavedLooks())
    server.use(
      http.get('*/api/v1/wardrobe/saved-looks', async () => {
        savedLookReads += 1
        await savedLooksHeld
        return HttpResponse.json({ message: 'Unavailable' }, { status: 503 })
      })
    )
    renderScreen()

    // Inventory and onboarding answered: the closet opens with no Saved Looks page out.
    const emptyTitle = await screen.findByText(i18n.t('wardrobe.empty_title'))
    await waitFor(() => expect(emptyTitle).toBeVisible())
    expect(screen.queryByTestId('screen-placeholder')).toBeNull()
    const emptyState = screen.getByTestId('wardrobe-empty-state')
    const body = screen.getByTestId('screen-gate-body-closet')
    expect(body.firstElementChild).toBe(emptyState)
    // Nothing follows the closet: no row, no list, no row error or Retry.
    expect(body.lastElementChild).toBe(emptyState)
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
    expect(screen.queryByTestId('closet-saved-looks-list')).toBeNull()
    expect(screen.queryByTestId('saved-looks-retry')).toBeNull()
    expect(savedLookReads).toBe(0)
  })

  // CC-7.12 D8: the return re-reads the inventory only; the saved looks re-read (and the row
  // that kept its count while it ran) left with the row.
  it('[7.12-NAT-024] 7.7-NAT-003 a return to the Closet re-reads the inventory in place and no saved looks', async () => {
    onTestFinished(() => screenFocus.reset())
    setMobileApplicationUserId('closet-return-owner')
    renderScreen()
    const emptyTitle = await screen.findByText(i18n.t('wardrobe.empty_title'))
    await waitFor(() => expect(emptyTitle).toBeVisible())
    const body = screen.getByTestId('screen-gate-body-closet')

    let garmentReads = 0
    let savedLookReads = 0
    let releaseReads!: () => void
    const readsHeld = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    onTestFinished(() => releaseReads())
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        garmentReads += 1
        await readsHeld
        return HttpResponse.json({ data: [] })
      }),
      http.get('*/api/v1/wardrobe/saved-looks', async () => {
        savedLookReads += 1
        await readsHeld
        return HttpResponse.json({ data: [], total: 0, limit: 50, offset: 0 })
      })
    )

    // Leaving reads nothing: only the return does.
    act(() => screenFocus.set(false))
    expect(garmentReads).toBe(0)
    act(() => screenFocus.set(true))
    await waitFor(() => expect(garmentReads).toBe(1))

    // The closet stays as it was while the reads run: same mounted body (so its scroll
    // position), no placeholder, no first-read spinner.
    expect(screen.getByTestId('screen-gate-body-closet')).toBe(body)
    expect(screen.queryByTestId('screen-placeholder')).toBeNull()
    expect(screen.queryByLabelText('Loading wardrobe')).toBeNull()
    expect(emptyTitle).toBeVisible()
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
    act(() => releaseReads())
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate-body-closet').lastElementChild).toBe(
        screen.getByTestId('wardrobe-empty-state')
      )
    )
    // The Looks tab reads saved looks on its own focus; the Closet's return sent none.
    expect(savedLookReads).toBe(0)
  })

  // CC-7.12 D8: the row below the closet is gone, so the gap is held by the gate body's own
  // style and the closet is the body's only child for a member with saved looks.
  it('[7.12-NAT-024] 7.7-NAT-004 keeps the 24-point gate body gap with the closet as its only child, no Saved Looks row below', async () => {
    setMobileApplicationUserId('closet-gate-gap-owner')
    const { handlers } = createSavedLooksMswHandlers()
    server.use(...handlers)
    renderScreen()
    const emptyState = await screen.findByTestId('wardrobe-empty-state')
    await waitFor(() => expect(emptyState).toBeVisible())
    const body = screen.getByTestId('screen-gate-body-closet')

    // The ScrollView's gap reaches only its direct children; the gate body carries its own.
    expect(emptyState.parentElement).toBe(body)
    expect(body.firstElementChild).toBe(emptyState)
    expect(getComputedStyle(body).rowGap).toBe('24px')
    expect(body.children).toHaveLength(1)
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
  })

  it('7.9-NAT-PRIMARY-001 [7.11 D4] fills the top bar Add with the primary gold and keeps More and the empty Add neutral', async () => {
    renderScreen()
    const add = await screen.findByTestId('garment-capture-open')
    const light = colorRoles.light
    // D3: the screen's one main action takes the primary role, as web's Add Garment does.
    expect(getComputedStyle(add).backgroundColor).toBe(rgb(light.primary))
    expect(getComputedStyle(add.firstElementChild ?? add).color).toBe(
      rgb(light.onPrimary)
    )
    // CC-7.11 D4: Add lives in the tab top bar now, beside a neutral More.
    const bar = screen.getByTestId('app-top-bar')
    expect(bar.contains(add)).toBe(true)
    expect(bar.contains(screen.getByTestId('closet-more-menu'))).toBe(true)
    await waitFor(() => expect(screen.getByTestId('wardrobe-empty-add')).toBeVisible())
    for (const id of ['closet-more-menu', 'wardrobe-empty-add']) {
      expect(getComputedStyle(screen.getByTestId(id)).backgroundColor).not.toBe(
        rgb(light.primary)
      )
    }
  })

  it('7.9-NAT-INSET-002 insets the Closet body 16 from each edge, the shared tab body inset', async () => {
    renderScreen()
    const frame = (await screen.findByTestId('wardrobe-screen')).getBoundingClientRect()
    const emptyState = await screen.findByTestId('wardrobe-empty-state')
    await waitFor(() => expect(emptyState).toBeVisible())
    // CC-7.11 D4: the header actions left the body, so the closet itself opens it.
    const closet = emptyState.getBoundingClientRect()
    expect(closet.left - frame.left).toBeCloseTo(TAB_BODY_INSET, 0)
    expect(frame.right - closet.right).toBeCloseTo(TAB_BODY_INSET, 0)
  })

  it('4.4-MOB-HUB-01 renders the wardrobe hub header and empty state (regression)', async () => {
    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-screen')).toBeInTheDocument()
    })
    expect(screen.getByTestId('garment-capture-open')).toBeInTheDocument()
  })

  it('closes the style panel and fences saved looks when the current account changes', async () => {
    const ownerA = 'style-native-owner-a'
    const ownerB = 'style-native-owner-b'
    const garmentA = createReadyGarmentFixture({
      id: 'style-native-shared-garment-id',
      imageAccess: fixtureWardrobePhoto('#224466'),
    })
    const garmentB = {
      ...garmentA,
      imageAccess: fixtureWardrobePhoto('#663311'),
    }
    const wardrobeByBearer = new Map([
      [`Bearer ${fakeAccessToken(ownerA)}`, garmentA],
      [`Bearer ${fakeAccessToken(ownerB)}`, garmentB],
    ])
    let active = ownerA
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() =>
      fakeAccessToken(active)
    )
    setMobileApplicationUserId(active)
    nativeModalAccessibility.enabled = true
    const { handlers: savedLooksHandlers } = createSavedLooksMswHandlers()
    server.use(
      http.get('*/api/v1/wardrobe/garments', ({ request }) => {
        const garment = wardrobeByBearer.get(request.headers.get('Authorization') ?? '')
        return garment
          ? HttpResponse.json({ data: [garment] })
          : new HttpResponse(null, { status: 401 })
      }),
      ...savedLooksHandlers
    )
    renderScreen()

    await expectCardPhoto(garmentA.id, garmentA.imageAccess!.url)
    expect(screen.getByTestId('wardrobe-screen')).not.toHaveAttribute('aria-hidden')
    await browserUser.click(
      await screen.findByRole('button', { name: 'Style this piece' })
    )
    const panel = await screen.findByTestId('style-piece-panel')
    const wardrobe = screen.getByTestId('wardrobe-screen')
    expect(wardrobe).toHaveAttribute('aria-hidden', 'true')
    expect(wardrobe).toHaveAttribute(
      'data-important-for-accessibility',
      'no-hide-descendants'
    )
    const [firstLook] = await within(panel).findAllByTestId('style-piece-look')
    await browserUser.click(within(firstLook!).getByRole('button', { name: 'Save look' }))
    expect(await within(panel).findByTestId('style-piece-reopen')).toHaveAccessibleName(
      /^Open saved look\b/
    )

    act(() => {
      active = ownerB
      setMobileApplicationUserId(active)
    })
    await expectCardPhoto(garmentB.id, garmentB.imageAccess.url)
    expect(screen.queryByTestId('style-piece-panel')).toBeNull()
    const currentWardrobe = screen.getByTestId('wardrobe-screen')
    expect(currentWardrobe).not.toHaveAttribute('aria-hidden')
    expect(currentWardrobe).toHaveAttribute('data-important-for-accessibility', 'auto')

    await browserUser.click(screen.getByRole('button', { name: 'Style this piece' }))
    const otherPanel = await screen.findByTestId('style-piece-panel')
    const otherAnchors = await within(otherPanel).findAllByTestId('style-piece-anchor')
    expect(otherAnchors).toHaveLength(3)
    await waitFor(() => {
      for (const anchor of otherAnchors) {
        expect(anchor.querySelector('img')).toHaveAttribute(
          'src',
          garmentB.imageAccess.url
        )
      }
    })
    await waitFor(() =>
      expect(within(otherPanel).getAllByTestId('style-piece-save')[0]).toBeEnabled()
    )
    expect(within(otherPanel).queryByTestId('style-piece-reopen')).toBeNull()

    act(() => {
      active = ownerA
      setMobileApplicationUserId(active)
    })
    await expectCardPhoto(garmentA.id, garmentA.imageAccess!.url)
    expect(screen.queryByTestId('style-piece-panel')).toBeNull()
    await browserUser.click(screen.getByRole('button', { name: 'Style this piece' }))
    const restored = await screen.findByTestId('style-piece-panel')
    expect(await within(restored).findByTestId('style-piece-reopen')).toBeVisible()
    await browserUser.click(within(restored).getByTestId('style-piece-remove'))
    await waitFor(() =>
      expect(within(restored).queryByTestId('style-piece-reopen')).toBeNull()
    )
  })

  it('reopens the edited weather and companions from the account saved looks API', async () => {
    nativeStyleRuntime.enabled = true
    setMobileApplicationUserId('style-native-file-owner')
    const garment = createReadyGarmentFixture({
      id: 'style-native-file-piece',
      imageAccess: fixtureWardrobePhoto('#224466'),
    })
    const { store, handlers } = createSavedLooksMswHandlers()
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garment] })
      ),
      ...handlers
    )
    renderScreen()
    await browserUser.click(await screen.findByTestId('style-piece-open'))
    const panel = await screen.findByTestId('style-piece-panel')
    await browserUser.click(
      await within(panel).findByTestId('style-piece-weather-warm-rainy')
    )
    const edited = within(panel)
      .getAllByTestId('style-piece-look')
      .find((look) => within(look).queryByText('Midi skirt', { exact: true }))!
    await browserUser.click(within(edited).getByTestId('style-piece-swap-shoes'))
    await browserUser.click(
      within(edited).getByTestId('style-piece-option-sample:g:loafers')
    )
    await browserUser.click(within(edited).getByTestId('style-piece-save'))
    expect(await within(panel).findByTestId('style-piece-reopen')).toHaveAccessibleName(
      /Warm and rainy.*Loafers/
    )

    expect(store.items).toHaveLength(1)
    expect(store.items[0]).toMatchObject({
      source: 'style_piece',
      lookId: 'sample:l:silk-midi',
      weather: 'warm-rainy',
      anchorGarmentId: garment.id,
      swaps: { shoes: 'sample:g:loafers' },
    })
    expect(store.items[0]?.composition.map((slot) => slot.slotIndex)).toEqual([
      0, 1, 2, 3,
    ])
    await browserUser.click(within(panel).getByTestId('style-piece-close'))
    await waitFor(() => expect(screen.queryByTestId('style-piece-panel')).toBeNull())
    await browserUser.click(await screen.findByTestId('style-piece-open'))
    const restored = await screen.findByTestId('style-piece-panel')
    await browserUser.click(await within(restored).findByTestId('style-piece-reopen'))
    await waitFor(() => {
      const reopened = within(restored).getAllByTestId('style-piece-look')[0]!
      for (const name of ['Rain shell', 'Midi skirt', 'Loafers']) {
        expect(within(reopened).getByText(name, { exact: true })).toBeVisible()
      }
      expect(within(restored).getByText('72°F', { exact: true })).toBeVisible()
    })
    await browserUser.click(within(restored).getByTestId('style-piece-remove'))
    await waitFor(() =>
      expect(within(restored).queryByTestId('style-piece-reopen')).toBeNull()
    )
    expect(store.items).toHaveLength(0)
  })

  it.each(['weather', 'swap'] as const)(
    'preserves a newer %s choice when a saved look finishes verifying',
    async (decision) => {
      nativeStyleRuntime.enabled = true
      const owner = 'style-native-reopen-race'
      setMobileApplicationUserId(owner)
      const garment = createReadyGarmentFixture({
        id: 'style-native-reopen-race-piece',
        imageAccess: fixtureWardrobePhoto('#224466'),
      })
      const renewed = { ...garment, imageAccess: fixtureWardrobePhoto('#663311') }
      const { handlers } = createSavedLooksMswHandlers([
        {
          id: 'seeded-mobile-race-1',
          ownerUserId: ACCESS_TOKEN,
          source: 'style_piece',
          lookId: 'sample:l:silk-midi',
          weather: 'warm-rainy',
          title: null,
          anchorGarmentId: garment.id,
          anchorSnapshot: {
            garmentId: garment.id,
            category: 'top',
            comfortRange: 'mild',
          },
          composition: [
            {
              slotIndex: 0,
              category: 'top',
              kind: 'garment',
              itemId: garment.id,
              label: null,
              missing: false,
              imageAccess: null,
            },
          ],
          swaps: {},
          collection: null,
          comfort: null,
          availabilityStatus: 'ready',
          missingGarmentIds: [],
          needsReviewReasons: [],
          revision: 0,
          createdAt: '2026-11-22T00:00:00.000Z',
          updatedAt: '2026-11-22T00:00:00.000Z',
        },
      ])
      const verification = deferred()
      const started = deferred()
      let reopenPending = false
      server.use(
        http.get('*/api/v1/wardrobe/garments', async () => {
          if (!reopenPending) return HttpResponse.json({ data: [garment] })
          started.resolve()
          await verification.promise
          return HttpResponse.json({ data: [renewed] })
        }),
        ...handlers
      )
      renderScreen()
      await browserUser.click(await screen.findByTestId('style-piece-open'))
      const panel = await screen.findByTestId('style-piece-panel')
      const reopen = await within(panel).findByTestId('style-piece-reopen')
      reopenPending = true
      try {
        await browserUser.click(reopen)
        await started.promise
        if (decision === 'weather') {
          await browserUser.click(
            within(panel).getByTestId('style-piece-weather-cool-windy')
          )
        } else {
          const [look] = within(panel).getAllByTestId('style-piece-look')
          await browserUser.click(within(look!).getByTestId('style-piece-swap-shoes'))
          await browserUser.click(
            within(look!).getByTestId('style-piece-option-sample:g:white-sneakers')
          )
        }
        nativeStyleRuntime.focus.mockClear()
        verification.resolve()
        await waitFor(() =>
          expect(
            within(panel).getAllByTestId('style-piece-anchor')[0]?.querySelector('img')
          ).toHaveAttribute('src', renewed.imageAccess.url)
        )
        expect(within(panel).queryByText('72°F', { exact: true })).toBeNull()
        if (decision === 'swap') {
          const [look] = within(panel).getAllByTestId('style-piece-look')
          expect(within(look!).getByText('White sneakers', { exact: true })).toBeVisible()
        }
        expect(nativeStyleRuntime.focus).not.toHaveBeenCalledWith(86)
      } finally {
        verification.resolve()
      }
    }
  )

  it('restores focus to the selected weather after foreground photo verification', async () => {
    nativeStyleRuntime.enabled = true
    setMobileApplicationUserId('style-native-foreground-owner')
    const garment = createReadyGarmentFixture({
      id: 'style-native-foreground-piece',
      imageAccess: fixtureWardrobePhoto('#224466'),
    })
    const verification = deferred()
    const started = deferred()
    let restoring = false
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        if (restoring) {
          started.resolve()
          await verification.promise
        }
        return HttpResponse.json({ data: [garment] })
      })
    )
    renderScreen()
    await browserUser.click(await screen.findByTestId('style-piece-open'))
    const panel = await screen.findByTestId('style-piece-panel')
    await browserUser.click(
      await within(panel).findByTestId('style-piece-weather-warm-rainy')
    )
    nativeStyleRuntime.focus.mockClear()
    try {
      changeNativeAppState('background')
      expect(within(panel).getByRole('progressbar')).toBeVisible()
      restoring = true
      changeNativeAppState('active')
      await started.promise
      expect(within(panel).queryByTestId('style-piece-weather-warm-rainy')).toBeNull()
      verification.resolve()
      expect(
        await within(panel).findByTestId('style-piece-weather-warm-rainy')
      ).toBeVisible()
      await waitFor(() =>
        expect(nativeStyleRuntime.focus).toHaveBeenCalledExactlyOnceWith(86)
      )
    } finally {
      verification.resolve()
    }
  })

  it('moves native accessibility focus to Close when the photo becomes unavailable and restores the garment action', async () => {
    nativeStyleRuntime.enabled = true
    setMobileApplicationUserId('style-native-expiry-owner')
    const ready = createReadyGarmentFixture({
      id: 'style-native-photo-unavailable',
      imageAccess: fixtureWardrobePhoto('#223355'),
    })
    let garment = ready
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [garment] }))
    )
    renderScreen()
    await browserUser.click(await screen.findByTestId('style-piece-open'))
    const panel = await screen.findByTestId('style-piece-panel')
    expect(await within(panel).findAllByTestId('style-piece-anchor')).toHaveLength(3)
    nativeStyleRuntime.focus.mockClear()
    changeNativeAppState('background')
    garment = { ...ready, imageAccess: null }
    changeNativeAppState('active')
    expect(await within(panel).findByTestId('style-piece-unavailable')).toBeVisible()
    await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenCalledWith(83))
    expect(within(panel).queryByTestId('style-piece-anchor')).toBeNull()

    nativeStyleRuntime.focus.mockClear()
    await browserUser.click(within(panel).getByTestId('style-piece-close'))
    await waitFor(() => expect(screen.getByTestId('style-piece-refresh')).toBeVisible())
    await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenCalledWith(82))
  })

  /**
   * Story CC-7.11 D13: the iOS retry flow inside Style this piece. The card refreshes an unsigned
   * photo, the panel opens on a held photo check that fails, one retry stays unsigned and the next
   * renews the photo, so the selected weather option (84) takes focus. The dialog's onShow is held
   * (`holdShow`); `showAtOpen` reports it while the photo check is still running, otherwise the
   * caller reports it after the retry, the late slide-in end that once took focus back to Close.
   */
  async function retryFailedPhotoInPanel(
    owner: string,
    { showAtOpen }: { showAtOpen: boolean }
  ) {
    nativeStyleRuntime.enabled = true
    setMobileApplicationUserId(owner)
    const ready = createReadyGarmentFixture({
      id: `${owner}-piece`,
      imageAccess: fixtureWardrobePhoto('#223355'),
    })
    const unsigned = { ...ready, imageAccess: null }
    const failedPhoto = {
      ...ready,
      imageAccess: { ...ready.imageAccess!, url: 'data:image/png;base64,AA==' },
    }
    const renewal = { ...ready, imageAccess: fixtureWardrobePhoto('#563312') }
    let garment: typeof ready = unsigned
    let holdVerification = false
    const verification = deferred()
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        const current = garment
        if (holdVerification) {
          holdVerification = false
          await verification.promise
        }
        return HttpResponse.json({ data: [current] })
      })
    )
    renderScreen()
    try {
      const cardRefresh = await screen.findByTestId('style-piece-refresh')
      expect(screen.queryByTestId('style-piece-open')).toBeNull()
      garment = ready
      await browserUser.click(cardRefresh)
      const opener = await screen.findByTestId('style-piece-open')
      await waitFor(() => expect(opener).toBeEnabled())

      garment = failedPhoto
      holdVerification = true
      nativeStyleRuntime.holdShow = true
      nativeStyleRuntime.focus.mockClear()
      await browserUser.click(opener)
      const panel = await screen.findByTestId('style-piece-panel')
      expect(within(panel).getByRole('progressbar')).toHaveTextContent(
        'Checking your photo'
      )
      expect(within(panel).queryByTestId('style-piece-anchor')).toBeNull()
      const finishShow = nativeStyleRuntime.finishShow
      expect(finishShow).toBeDefined()
      if (showAtOpen) {
        act(() => finishShow!())
        expect(nativeStyleRuntime.focus).toHaveBeenLastCalledWith(83)
      } else {
        expect(nativeStyleRuntime.focus).not.toHaveBeenCalled()
      }
      verification.resolve()

      expect(await within(panel).findByTestId('style-piece-unavailable')).toBeVisible()
      await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenLastCalledWith(83))
      const retry = within(panel).getByTestId('style-piece-refresh')
      garment = unsigned
      await browserUser.click(retry)
      await waitFor(() => expect(retry).toBeEnabled())
      expect(within(panel).queryByTestId('style-piece-save')).toBeNull()

      garment = renewal
      await browserUser.click(retry)
      const anchors = await within(panel).findAllByTestId('style-piece-anchor')
      expect(anchors).toHaveLength(3)
      for (const anchor of anchors) {
        expect(anchor.querySelector('img')).toHaveAttribute(
          'src',
          renewal.imageAccess.url
        )
      }
      await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenLastCalledWith(84))
      return { finishShow: finishShow!, panel }
    } finally {
      verification.resolve()
    }
  }

  /** The fake native handles setAccessibilityFocus received, in order. */
  const focusTargets = () => nativeStyleRuntime.focus.mock.calls.map(([target]) => target)

  it('refreshes an unsigned card and retries a failed photo inside the iOS styling panel', async () => {
    await retryFailedPhotoInPanel('style-native-retry-owner', { showAtOpen: true })
  })

  // [Codex 7.11 #8] Story CC-7.11 D13: the dialog's onShow focuses Close only while nothing in the
  // panel has moved focus since it opened. The CI flake: the slide-in ended after the retry had
  // focused the selected weather option, and onShow took focus back to Close (83 after 84).
  describe('[Codex 7.11 #8] Style this piece dialog onShow', () => {
    it('[P1] [Codex 7.11 #8] [7.11-NAT-031] a late dialog onShow does not take focus back from the weather option', async () => {
      const { finishShow, panel } = await retryFailedPhotoInPanel(
        'style-native-late-show-owner',
        { showAtOpen: false }
      )

      act(() => finishShow())
      await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())))

      expect(nativeStyleRuntime.focus).toHaveBeenLastCalledWith(84)
      const targets = focusTargets()
      expect(targets.lastIndexOf(83)).toBeLessThan(targets.lastIndexOf(84))
      expect(within(panel).getByTestId('style-piece-weather-mild-dry')).toBeVisible()
    })

    it('[P1] [Codex 7.11 #8] [7.11-NAT-031] a dialog onShow before any content moved focus focuses Close', async () => {
      nativeStyleRuntime.enabled = true
      setMobileApplicationUserId('style-native-early-show-owner')
      const garment = createReadyGarmentFixture({
        id: 'style-native-early-show-piece',
        imageAccess: fixtureWardrobePhoto('#335522'),
      })
      const verification = deferred()
      let holdVerification = false
      server.use(
        http.get('*/api/v1/wardrobe/garments', async () => {
          if (holdVerification) {
            holdVerification = false
            await verification.promise
          }
          return HttpResponse.json({ data: [garment] })
        })
      )
      renderScreen()
      try {
        const opener = await screen.findByTestId('style-piece-open')
        await waitFor(() => expect(opener).toBeEnabled())
        holdVerification = true
        nativeStyleRuntime.holdShow = true
        nativeStyleRuntime.focus.mockClear()
        await browserUser.click(opener)
        const panel = await screen.findByTestId('style-piece-panel')
        expect(within(panel).getByRole('progressbar')).toBeVisible()
        expect(nativeStyleRuntime.focus).not.toHaveBeenCalled()
        expect(nativeStyleRuntime.finishShow).toBeDefined()

        act(() => nativeStyleRuntime.finishShow!())

        expect(nativeStyleRuntime.focus).toHaveBeenCalledExactlyOnceWith(83)
        verification.resolve()
        expect(await within(panel).findAllByTestId('style-piece-anchor')).toHaveLength(3)
      } finally {
        verification.resolve()
      }
    })
  })

  it('restores the Android garment action when verification finishes after dismissal', async () => {
    nativeStyleRuntime.enabled = true
    nativeStyleRuntime.platform = 'android'
    setMobileApplicationUserId('style-android-dismiss-owner')
    const garment = createReadyGarmentFixture({
      id: 'style-android-dismiss-piece',
      imageAccess: fixtureWardrobePhoto('#225543'),
    })
    const reply = deferred()
    const started = deferred()
    let verifying = false
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        if (verifying) {
          started.resolve()
          await reply.promise
        }
        return HttpResponse.json({ data: [garment] })
      })
    )
    renderScreen()
    try {
      const opener = await screen.findByTestId('style-piece-open')
      verifying = true
      await browserUser.click(opener)
      const panel = await screen.findByTestId('style-piece-panel')
      expect(within(panel).getByRole('progressbar')).toBeVisible()
      await started.promise
      await browserUser.click(within(panel).getByTestId('style-piece-close'))
      await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenLastCalledWith(82))
      expect(screen.queryByTestId('style-piece-panel')).toBeNull()

      verifying = false
      reply.resolve()
      await browserUser.click(opener)
      const reopened = await screen.findByTestId('style-piece-panel')
      expect(await within(reopened).findAllByTestId('style-piece-anchor')).toHaveLength(3)
    } finally {
      reply.resolve()
    }
  })

  it('keeps the photo and swap controls available when saved looks fail to load', async () => {
    nativeStyleRuntime.enabled = true
    const owner = 'style-native-storage-error'
    setMobileApplicationUserId(owner)
    const garment = createReadyGarmentFixture({
      id: 'style-native-storage-piece',
      imageAccess: fixtureWardrobePhoto('#225543'),
    })
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garment] })
      ),
      http.get('*/api/v1/wardrobe/saved-looks', () =>
        HttpResponse.json({ message: 'Unavailable' }, { status: 503 })
      )
    )
    renderScreen()
    await browserUser.click(await screen.findByTestId('style-piece-open'))
    const panel = await screen.findByTestId('style-piece-panel')
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Could not load your saved looks.'
    )
    const [look] = await within(panel).findAllByTestId('style-piece-look')
    expect(within(look!).getByTestId('style-piece-anchor')).toBeVisible()
    await browserUser.click(within(look!).getByTestId('style-piece-swap-shoes'))
    await browserUser.click(
      within(look!).getByTestId('style-piece-option-sample:g:white-sneakers')
    )
    expect(within(look!).getByText('White sneakers', { exact: true })).toBeVisible()
  })

  it('queues a completed tagging poll until the styling modal is dismissed', async () => {
    nativeStyleRuntime.enabled = true
    nativeStyleRuntime.holdDismissal = true
    setMobileApplicationUserId('style-native-queue-owner')
    const garment = createReadyGarmentFixture({
      id: 'style-native-queue-piece',
      imageAccess: fixtureWardrobePhoto('#224466'),
    })
    let deferNextRead = false
    let pollStarted = false
    let settled = false
    let releasePoll!: () => void
    const pollReply = new Promise<void>((resolve) => {
      releasePoll = resolve
    })
    const taggingId = 'style-native-pending-tags'
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        if (deferNextRead) {
          deferNextRead = false
          pollStarted = true
          await pollReply
          settled = true
        }
        return HttpResponse.json({
          data: [
            garment,
            garmentFixture({
              id: taggingId,
              status: settled ? 'awaiting_tags' : 'processing',
            }),
          ],
        })
      }),
      http.post(`*/api/v1/wardrobe/garments/${taggingId}/suggest-tags`, () =>
        HttpResponse.json({
          data: createSuggestGarmentTagsDataFixture({ garmentId: taggingId }),
        })
      )
    )
    renderScreen()
    const checkStatus = await screen.findByRole('button', {
      name: 'Check garment status',
    })
    deferNextRead = true
    try {
      await browserUser.click(checkStatus)
      await waitFor(() => expect(pollStarted).toBe(true))
      await browserUser.click(await screen.findByTestId('style-piece-open'))
      const panel = await screen.findByTestId('style-piece-panel')
      releasePoll()
      await screen.findByTestId('garment-status-awaiting_tags')
      expect(screen.queryByTestId('garment-tagging-modal')).toBeNull()

      await browserUser.click(within(panel).getByTestId('style-piece-close'))
      expect(screen.queryByTestId('style-piece-panel')).toBeNull()
      expect(screen.queryByTestId('garment-tagging-modal')).toBeNull()
      await waitFor(() =>
        expect(nativeStyleRuntime.finishDismissal).toBeTypeOf('function')
      )
      act(() => nativeStyleRuntime.finishDismissal?.())
      await waitFor(() =>
        expect(screen.getByTestId('garment-tagging-modal')).toBeVisible()
      )
    } finally {
      releasePoll()
    }
  })

  it('rejects a late styling snapshot after the tagging poll has settled', async () => {
    nativeStyleRuntime.enabled = true
    setMobileApplicationUserId('style-native-inventory-race-owner')
    const anchor = createReadyGarmentFixture({
      id: 'style-native-inventory-anchor',
      imageAccess: fixtureWardrobePhoto('#224466'),
    })
    const processing = garmentFixture({
      id: 'style-native-inventory-poll',
      status: 'processing',
    })
    const settled = createReadyGarmentFixture({ id: processing.id })
    const photoCheck = deferred()
    const poll = deferred()
    const pollStarted = deferred()
    const photoCheckStarted = deferred()
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        const read = ++reads
        if (read === 2) {
          pollStarted.resolve()
          await poll.promise
          return HttpResponse.json({ data: [anchor, settled] })
        }
        if (read === 3) {
          photoCheckStarted.resolve()
          await photoCheck.promise
        }
        return HttpResponse.json({
          data: read > 3 ? [settled] : [anchor, processing],
        })
      })
    )
    renderScreen()
    try {
      await browserUser.click(
        await screen.findByRole('button', { name: 'Check garment status' })
      )
      await pollStarted.promise
      await browserUser.click(await screen.findByTestId('style-piece-open'))
      const panel = await screen.findByTestId('style-piece-panel')
      await photoCheckStarted.promise
      poll.resolve()
      await waitFor(() =>
        expect(screen.queryByTestId('garment-status-processing')).toBeNull()
      )

      photoCheck.resolve()
      await waitFor(() => expect(within(panel).queryByRole('progressbar')).toBeNull())
      expect(screen.queryByTestId('garment-status-processing')).toBeNull()
      expect(within(panel).queryByTestId('style-piece-anchor')).toBeNull()
      await waitFor(() =>
        expect(screen.getByTestId(`garment-card-${anchor.id}`)).toBeVisible()
      )

      await browserUser.click(within(panel).getByTestId('style-piece-refresh'))
      await waitFor(() =>
        expect(screen.queryByTestId(`garment-card-${anchor.id}`)).toBeNull()
      )
      expect(within(panel).queryByTestId('style-piece-anchor')).toBeNull()
    } finally {
      poll.resolve()
      photoCheck.resolve()
    }
  })

  it('keeps a deleted styling garment hidden when an older poll snapshot settles', async () => {
    nativeStyleRuntime.enabled = true
    setMobileApplicationUserId('style-native-poll-race-owner')
    const anchor = createReadyGarmentFixture({
      id: 'style-native-poll-anchor',
      imageAccess: fixtureWardrobePhoto('#224466'),
    })
    const processing = garmentFixture({
      id: 'style-native-poll-garment',
      status: 'processing',
    })
    const settled = createReadyGarmentFixture({ id: processing.id })
    const poll = deferred()
    const pollStarted = deferred()
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        const read = ++reads
        if (read === 2) {
          pollStarted.resolve()
          await poll.promise
          return HttpResponse.json({ data: [anchor, settled] })
        }
        const data =
          read === 1 ? [anchor, processing] : [read === 3 ? processing : settled]
        return HttpResponse.json({ data })
      })
    )
    renderScreen()
    try {
      await browserUser.click(
        await screen.findByRole('button', { name: 'Check garment status' })
      )
      await pollStarted.promise
      await browserUser.click(await screen.findByTestId('style-piece-open'))
      const panel = await screen.findByTestId('style-piece-panel')
      expect(await within(panel).findByTestId('style-piece-unavailable')).toBeVisible()
      expect(screen.queryByTestId(`garment-card-${anchor.id}`)).toBeNull()

      poll.resolve()
      await waitFor(() =>
        expect(screen.queryByTestId('garment-status-processing')).toBeNull()
      )
      expect(screen.queryByTestId(`garment-card-${anchor.id}`)).toBeNull()
      expect(within(panel).queryByTestId('style-piece-anchor')).toBeNull()
    } finally {
      poll.resolve()
    }
  })

  it('withholds the empty state until the failed garment list is retried successfully', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json(null, { status: 503 })
      )
    )

    renderScreen()

    const retry = await screen.findByTestId('wardrobe-list-retry')
    // CC-7.11 D4: the failure notice opens the gate body; no setup card sits above it.
    await waitFor(() => expect(retry).toBeVisible())
    expect(
      screen.getByTestId('screen-gate-body-closet').firstElementChild?.contains(retry)
    ).toBe(true)
    const empty = i18n.t('wardrobe.empty_title')
    expect(screen.queryByText(empty)).toBeNull()
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] }))
    )
    await browserUser.click(retry)

    await waitFor(() => expect(screen.getByText(empty)).toBeVisible())
    expect(screen.queryByTestId('wardrobe-list-retry')).toBeNull()
  })

  it('opens the existing garment awaiting tags from direct entry', async () => {
    setMobileApplicationUserId('user-1')
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture()] })
      ),
      http.post('*/api/v1/wardrobe/garments/garment-1/suggest-tags', () =>
        HttpResponse.json({ data: createSuggestGarmentTagsDataFixture() })
      )
    )

    renderHub(<WardrobeHubScreen addEntry />)

    await waitFor(() => expect(screen.getByTestId('garment-tagging-modal')).toBeVisible())
    expect(routerMock.setParams).toHaveBeenCalledExactlyOnceWith({ entry: undefined })
    expect(screen.queryByTestId('garment-capture-modal')).toBeNull()
  })

  it('checks an existing processing garment from direct entry and opens its tags', async () => {
    setMobileApplicationUserId('user-1')
    server.use(
      http.get(
        '*/api/v1/wardrobe/garments',
        () => HttpResponse.json({ data: [garmentFixture({ status: 'processing' })] }),
        { once: true }
      ),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture()] })
      ),
      http.post('*/api/v1/wardrobe/garments/garment-1/suggest-tags', () =>
        HttpResponse.json({ data: createSuggestGarmentTagsDataFixture() })
      )
    )

    renderHub(<WardrobeHubScreen addEntry pollOffsetsMs={[1]} />)

    await waitFor(() =>
      expect(screen.getByTestId('garment-status-processing')).toBeVisible()
    )
    expect(screen.queryByTestId('garment-capture-modal')).toBeNull()
    await browserUser.click(screen.getByRole('button', { name: 'Check garment status' }))
    await waitFor(() => expect(screen.getByTestId('garment-tagging-modal')).toBeVisible())
    expect(routerMock.setParams).toHaveBeenCalledExactlyOnceWith({ entry: undefined })
  })

  it('4.4-MOB-HUB-02 opens the extracted capture modal from the existing entry point (regression)', async () => {
    renderScreen()
    await waitFor(() => screen.getByTestId('garment-capture-open'))

    fireEvent.click(screen.getByTestId('garment-capture-open'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-modal')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-03 captures a garment end to end and opens tagging once it needs tags (regression)', async () => {
    server.use(...captureUploadHandlers('garment-1', 'awaiting_tags'))

    renderScreen()
    await captureOneGarment()
    fireEvent.click(screen.getByTestId('garment-capture-done'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-03B polls a still-processing commit until it needs tags, then opens tagging (regression, 4.4-R05)', async () => {
    // Exercise the handoff from the capture modal's processing commit to the
    // screen's poll. Hold the settling response until the processing UI is checked.
    let garmentListReads = 0
    let releaseAwaitingTags!: () => void
    const awaitingTagsResponse = new Promise<void>((resolve) => {
      releaseAwaitingTags = resolve
    })
    server.use(
      ...captureUploadHandlers('garment-2', 'processing'),
      http.get('*/api/v1/wardrobe/garments', async () => {
        garmentListReads += 1
        if (garmentListReads === 1) return HttpResponse.json({ data: [] })
        if (garmentListReads === 2) {
          return HttpResponse.json({
            data: [garmentFixture({ id: 'garment-2', status: 'processing' })],
          })
        }
        await awaitingTagsResponse
        return HttpResponse.json({
          data: [garmentFixture({ id: 'garment-2', status: 'awaiting_tags' })],
        })
      })
    )

    try {
      renderScreen()
      await screen.findByText('No garments added yet')
      await captureOneGarment()
      await browserUser.click(screen.getByTestId('garment-capture-done'))

      // The second poll has started, so the first processing response reached
      // the screen. The held response prevents the short poll budget racing ahead.
      await waitFor(() => expect(garmentListReads).toBe(3))
      expect(screen.getByTestId('garment-status-processing')).toBeInTheDocument()
      expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()
      expect(screen.queryByTestId('wardrobe-error-banner')).not.toBeInTheDocument()

      releaseAwaitingTags()
      await waitFor(() => {
        expect(screen.getByTestId('garment-status-awaiting_tags')).toBeInTheDocument()
        expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
      })
      expect(garmentListReads).toBe(3)
      expect(screen.queryByTestId('wardrobe-error-banner')).not.toBeInTheDocument()
    } finally {
      releaseAwaitingTags()
    }
  })

  /** Opens the Closet's More sheet from the top bar (Story CC-7.11 D5). */
  async function openMoreSheet() {
    const more = await screen.findByTestId('closet-more-menu')
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    )
    await act(() => Promise.resolve())
    press(more)
    return screen.findByTestId('closet-more-sheet')
  }

  it('4.4-MOB-HUB-04 [7.11 D5] lists Closet setup in the More sheet while onboarding is not completed and opens it', async () => {
    renderScreen()
    const sheet = await openMoreSheet()

    const setup = within(sheet).getByTestId('closet-more-setup')
    await waitFor(() => expect(setup).toHaveTextContent(i18n.t('wardrobe.menu.setup')))
    expect(setup).not.toHaveTextContent(i18n.t('wardrobe.menu.setupDone'))
    // D4: no setup card sits in the Closet body any more.
    expect(screen.queryByTestId('wardrobe-onboarding-card')).toBeNull()

    fireEvent.click(setup)
    expect(routerMock.push).toHaveBeenCalledExactlyOnceWith('/wardrobe-onboarding')
    await waitFor(() => expect(screen.queryByTestId('closet-more-sheet')).toBeNull())
  })

  it('4.4-MOB-HUB-05 [7.11 D5] reads "Closet setup: done" in the More sheet once onboarding is completed', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: onboardingCompleted })
      )
    )
    renderScreen()
    const sheet = await openMoreSheet()

    await waitFor(() =>
      expect(within(sheet).getByTestId('closet-more-setup')).toHaveTextContent(
        i18n.t('wardrobe.menu.setupDone')
      )
    )
    expect(i18n.t('wardrobe.menu.setupDone')).toBe('Closet setup: done')
    expect(screen.queryByTestId('wardrobe-onboarding-card')).toBeNull()
  })

  it('4.4-MOB-HUB-06 [7.11 D5] opens the silhouette settings screen from the More sheet', async () => {
    renderScreen()
    const sheet = await openMoreSheet()

    const silhouette = within(sheet).getByTestId('closet-more-silhouette')
    expect(silhouette).toHaveTextContent(i18n.t('wardrobe.menu.silhouette'))
    fireEvent.click(silhouette)
    expect(routerMock.push).toHaveBeenCalledExactlyOnceWith('/wardrobe-silhouette')
    await waitFor(() => expect(screen.queryByTestId('closet-more-sheet')).toBeNull())
  })

  it('4.4-MOB-HUB-07 [7.11 D5, D8] lists only setup and Silhouette in the More sheet: Capsules moved to Looks', async () => {
    renderScreen()
    const sheet = await openMoreSheet()

    const rows = Array.from(sheet.querySelectorAll('[data-testid^="closet-more-"]'))
      .map((row) => row.getAttribute('data-testid'))
      .filter((id) => id !== 'closet-more-close')
    expect(rows).toEqual(['closet-more-setup', 'closet-more-silhouette'])
    expect(sheet).not.toHaveTextContent(i18n.t('wardrobe.capsules.title'))
    // The Looks tab carries the Capsules row (screen-budget-looks.test.tsx, 7.11-NAT-014).
    expect(screen.queryByTestId('wardrobe-capsules-link')).toBeNull()
    expect(screen.queryByText(i18n.t('wardrobe.capsules.title'))).toBeNull()
  })

  it('4.4-MOB-HUB-08 [7.11 D4] does not let a broken onboarding read hide the garment list (regression)', async () => {
    server.use(http.get('*/api/v1/wardrobe/onboarding', () => HttpResponse.error()))

    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-empty-state')).toBeVisible()
    })
    // The failed read leaves the setup row as it was: not done.
    const sheet = await openMoreSheet()
    expect(within(sheet).getByTestId('closet-more-setup')).toHaveTextContent(
      i18n.t('wardrobe.menu.setup')
    )
    expect(within(sheet).getByTestId('closet-more-setup')).not.toHaveTextContent(
      i18n.t('wardrobe.menu.setupDone')
    )
  })

  it("4.4-MOB-HUB-09 shows a recovery action when a member's wardrobe session is missing", async () => {
    // Story CC-7.9 add-on B: this is a member (the screen holds their id) whose token is gone. A
    // visitor who never signed in has no failure to recover from; 7.9-NAT-VISITOR covers them.
    setMobileApplicationUserId('member-session-lapsed')
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    renderScreen()

    expect(await screen.findByTestId('wardrobe-list-retry')).toBeEnabled()
    expect(screen.queryByText(i18n.t('wardrobe.empty_title'))).toBeNull()
    expect(screen.queryByLabelText('Loading wardrobe')).toBeNull()
    expect(screen.queryByTestId('wardrobe-sign-in')).toBeNull()
  })

  it('7.9-NAT-VISITOR offers sign-in, and no failure, to a visitor who never signed in', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    renderScreen()

    const signIn = await screen.findByTestId('wardrobe-sign-in')
    expect(signIn).toHaveTextContent(i18n.t('community.notifications.signin'))
    expect(screen.queryByTestId('wardrobe-list-retry')).toBeNull()
    expect(screen.queryByTestId('wardrobe-error-banner')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    // react-native-web refreshes a Pressable's onPress in a passive effect; flushing effects first
    // means Add presses with the visitor render's handler (src/test-utils/press.ts).
    await act(() => Promise.resolve())
    press(signIn)
    expect(routerMock.push).toHaveBeenLastCalledWith('/signin')
    routerMock.push.mockClear()
    press(screen.getByTestId('garment-capture-open'))
    expect(routerMock.push).toHaveBeenCalledExactlyOnceWith('/signin')
    expect(screen.queryByTestId('garment-capture-modal')).toBeNull()
  })

  // Review P2-2: the session evidence lives above the identity-epoch keyed hub, so a sign-out or
  // expiry that remounts the hub keeps it. Only a screen that never saw a session is a visitor.
  it('7.9-NAT-VISITOR-02 a fresh visitor (no token, no member from the start) gets the sign-in offer', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    renderScreen()

    expect(await screen.findByTestId('wardrobe-sign-in')).toBeInTheDocument()
    expect(screen.queryByTestId('wardrobe-list-retry')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('7.9-NAT-VISITOR-03 a returning session that fails before verification keeps the failure notice', async () => {
    // A stored token resolves but no member is named yet, and the API refuses it; the session
    // is then cleared, so the Retry read finds no token while no member ever held the screen.
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      )
    )
    renderScreen()
    const retry = await screen.findByTestId('wardrobe-list-retry')
    expect(screen.queryByTestId('wardrobe-sign-in')).toBeNull()

    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    await waitFor(() => expect(retry).toBeEnabled())
    press(retry)

    await waitFor(() => expect(screen.getByTestId('wardrobe-list-retry')).toBeEnabled())
    expect(screen.queryByTestId('wardrobe-sign-in')).toBeNull()
    expect(screen.queryByTestId('wardrobe-visitor-offer')).toBeNull()
  })

  it('7.9-NAT-VISITOR-04 a verified session that ends with the Closet open keeps the failure notice', async () => {
    setMobileApplicationUserId('member-1')
    renderScreen()
    expect(await screen.findByText(i18n.t('wardrobe.empty_title'))).toBeInTheDocument()

    // The session ends: the token is gone and the identity epoch advances, remounting the hub.
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    act(() => setMobileApplicationUserId(null))

    expect(await screen.findByTestId('wardrobe-list-retry')).toBeEnabled()
    expect(screen.queryByTestId('wardrobe-sign-in')).toBeNull()
    expect(screen.queryByTestId('wardrobe-visitor-offer')).toBeNull()
  })

  it('4.4-MOB-HUB-10 opens tagging from the Needs tags action on an already-untagged garment', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture()] })
      )
    )
    renderScreen()

    await waitFor(() => screen.getByLabelText('Needs tags'))
    fireEvent.click(screen.getByLabelText('Needs tags'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-11 refuses to open tagging with an expired session and says why', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture()] })
      )
    )
    renderScreen()
    await waitFor(() => screen.getByLabelText('Needs tags'))

    // The session lapses between listing the wardrobe and tapping the action;
    // the token is re-resolved at tap time precisely for this case.
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    fireEvent.click(screen.getByLabelText('Needs tags'))

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-error-banner')).toHaveTextContent(
        'Sign in to manage your wardrobe.'
      )
    })
    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()
  })

  it('4.4-MOB-HUB-12 reflects confirmed tags in the grid and re-reads the wardrobe', async () => {
    // The hub owns what happens *after* the modal saves: it patches the garment
    // into the grid and then re-reads the wardrobe so anything the server
    // changed alongside the tags shows up. Only an end-to-end save through the
    // real network path proves that seam.
    let garmentListReads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        return HttpResponse.json({
          data:
            garmentListReads === 1
              ? [garmentFixture()]
              : [
                  garmentFixture({ id: 'garment-1', status: 'ready' }),
                  garmentFixture({ id: 'garment-refreshed', status: 'ready' }),
                ],
        })
      }),
      http.post('*/api/v1/wardrobe/garments/:garmentId/suggest-tags', () =>
        HttpResponse.json({
          data: createSuggestGarmentTagsDataFixture({ garmentId: 'garment-1' }),
        })
      ),
      http.patch('*/api/v1/wardrobe/garments/:garmentId/tags', () =>
        HttpResponse.json({ data: garmentFixture({ id: 'garment-1', status: 'ready' }) })
      )
    )
    renderScreen()

    await waitFor(() => screen.getByLabelText('Needs tags'))
    fireEvent.click(screen.getByLabelText('Needs tags'))

    // Saving is only possible once the confident suggestions have been applied,
    // so wait on that rather than on the button merely existing.
    await screen.findByText('AI suggested: Top')
    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-save')).toBeEnabled()
    })
    press(screen.getByTestId('garment-tagging-save'))

    // The second wardrobe read is what surfaces `garment-refreshed`; asserting
    // on it proves the re-read happened without counting mock calls.
    await waitFor(() => {
      expect(screen.getByTestId('garment-card-garment-refreshed')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('garment-status-ready')).toHaveLength(2)
    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()
  })

  it('4.4-MOB-HUB-13 resumes a timed-out garment when it is ready to tag', async () => {
    server.use(
      ...captureUploadHandlers('garment-3', 'processing'),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({
          data: [garmentFixture({ id: 'garment-3', status: 'processing' })],
        })
      )
    )
    renderScreen()
    await captureOneGarment()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-error-banner')).toHaveTextContent(
        'Smart tagging is taking longer than expected.'
      )
    })
    await browserUser.click(screen.getByTestId('garment-capture-done'))
    expect(screen.queryByLabelText('Needs tags')).not.toBeInTheDocument()
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({
          data: [garmentFixture({ id: 'garment-3', status: 'awaiting_tags' })],
        })
      )
    )
    await browserUser.click(screen.getByRole('button', { name: 'Check garment status' }))
    await waitFor(() => expect(screen.getByTestId('garment-tagging-modal')).toBeVisible())
  })

  it('4.4-MOB-HUB-14 surfaces a wardrobe read failure that happens mid-poll', async () => {
    let garmentListReads = 0
    server.use(
      ...captureUploadHandlers('garment-4', 'processing'),
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        if (garmentListReads === 1) {
          return HttpResponse.json({ data: [] })
        }
        return HttpResponse.json(
          {
            statusCode: 503,
            message: 'Wardrobe temporarily unavailable',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      })
    )
    renderScreen()
    await captureOneGarment()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-error-banner')).toHaveTextContent(
        'Wardrobe temporarily unavailable'
      )
    })
  })

  it('4.4-MOB-HUB-15 defers tagging until the capture sheet closes when the poll settles first', async () => {
    let garmentListReads = 0
    server.use(
      ...captureUploadHandlers('garment-5', 'processing'),
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        return HttpResponse.json({
          data:
            garmentListReads === 1
              ? []
              : [garmentFixture({ id: 'garment-5', status: 'awaiting_tags' })],
        })
      })
    )
    // Slow enough that the poll resolves while the capture sheet is still up,
    // which is the ordering this deferral exists for.
    renderScreen([40, 80, 160, 320])
    await captureOneGarment()

    await waitFor(() => {
      expect(screen.getByTestId('garment-status-awaiting_tags')).toBeInTheDocument()
    })
    // Stacking the tagging sheet on top of the still-open capture sheet would
    // trap focus between two modals.
    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('garment-capture-done'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
    })
  })

  // Story 6.15 F-00i: at iOS accessibility-medium Add garment ran past the screen edge beside the
  // two links. A narrow window stands in for the larger text. Story CC-7.11 D4: Add and More sit
  // in the top bar now; both stay inside it and the Closet title keeps its whole word.
  it('6.15-MOB-WRAP-03 [7.11 D4] keeps Add, More and the whole Closet title inside a narrow top bar', async () => {
    await setViewport(260, 896)
    try {
      renderScreen()
      const add = await waitFor(() => screen.getByTestId('garment-capture-open'))
      const more = screen.getByTestId('closet-more-menu')
      const barBox = screen.getByTestId('app-top-bar').getBoundingClientRect()
      const addBox = add.getBoundingClientRect()
      const moreBox = more.getBoundingClientRect()
      expect(addBox.left).toBeGreaterThanOrEqual(barBox.left - 0.5)
      expect(moreBox.left).toBeGreaterThanOrEqual(addBox.right - 0.5)
      expect(moreBox.right).toBeLessThanOrEqual(barBox.right + 0.5)
      const title = screen.getByTestId('app-top-bar-title')
      expect(title).toHaveTextContent(i18n.t('tabs.closet'))
      // One line with an ellipsis would scroll wider than it shows.
      expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth)
      expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(addBox.left + 0.5)
    } finally {
      await setViewport(414, 896)
    }
  })

  it('[7.12-NAT-024] imports native device-saved files for the active member, marks unresolved looks Needs review, tells the Looks feed, and leaves other accounts untouched', async () => {
    nativeStyleRuntime.enabled = true
    const activeOwner = 'native-import-member-a'
    setMobileApplicationUserId(activeOwner)
    const readyTop = createReadyGarmentFixture({
      id: 'native-import-top',
      category: 'top',
      comfortRange: 'mild',
      imageAccess: fixtureWardrobePhoto('#224466'),
    })
    const changedOuterwear = createReadyGarmentFixture({
      id: 'native-import-changed',
      category: 'outerwear',
      comfortRange: 'cold',
      imageAccess: fixtureWardrobePhoto('#446622'),
    })

    const encodeScope = (o: string, g: string) =>
      `couturecast.style-piece.${encodeURIComponent(JSON.stringify([o, g]))
        .replaceAll('~', '%7E')
        .replaceAll('%', '~')}`

    const ownTopUri = `file:///documents/${encodeScope(activeOwner, readyTop.id)}.json`
    const ownChangedUri = `file:///documents/${encodeScope(activeOwner, changedOuterwear.id)}.json`
    const ownOlderGarmentId = 'garment-older-outside-page'
    const ownOlderUri = `file:///documents/${encodeScope(activeOwner, ownOlderGarmentId)}.json`
    const otherMemberUri = `file:///documents/${encodeScope('native-import-member-b', readyTop.id)}.json`

    nativeStyleRuntime.files.set(
      ownTopUri,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: { shoes: 'sample:g:white-sneakers' },
        },
      ])
    )
    nativeStyleRuntime.files.set(
      ownChangedUri,
      JSON.stringify([
        {
          lookId: 'sample:l:silk-midi',
          weather: 'warm-rainy',
          swaps: { shoes: 'sample:g:loafers' },
        },
      ])
    )
    nativeStyleRuntime.files.set(
      ownOlderUri,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: {},
        },
      ])
    )
    nativeStyleRuntime.files.set(
      otherMemberUri,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: {},
        },
      ])
    )

    const savedLooksChanges: (string | null)[] = []
    onTestFinished(
      subscribeMobileSavedLooksChanged((owner) => savedLooksChanges.push(owner))
    )
    const { store, handlers } = createSavedLooksMswHandlers()
    store.garmentTagsById.set(ownOlderGarmentId, {
      category: 'top',
      comfortRange: 'mild',
    })
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [readyTop, changedOuterwear] })
      ),
      ...handlers
    )

    renderScreen()

    await waitFor(() => expect(store.items).toHaveLength(3))
    expect(
      store.items.find((item) => item.anchorGarmentId === changedOuterwear.id)
        ?.availabilityStatus
    ).toBe('needs_review')
    expect(
      store.items.find((item) => item.anchorGarmentId === readyTop.id)?.availabilityStatus
    ).toBe('ready')
    // Older owned garment outside Closet inventory page is discovered via Directory.list()
    expect(
      store.items.find((item) => item.anchorGarmentId === ownOlderGarmentId)
        ?.availabilityStatus
    ).toBe('ready')

    // CC-7.12 D8: the imported looks show on the Looks tab, which reads again on this owner's
    // change notice; the Closet itself shows no row and no Needs review badge.
    await waitFor(() => expect(savedLooksChanges).toContain(activeOwner))
    expect(savedLooksChanges.every((owner) => owner === activeOwner)).toBe(true)
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
    expect(screen.queryByTestId('saved-look-needs-review')).toBeNull()

    // Active member's native files are deleted after import while other member's file remains intact
    await waitFor(() => {
      expect(nativeStyleRuntime.files.has(ownTopUri)).toBe(false)
      expect(nativeStyleRuntime.files.has(ownChangedUri)).toBe(false)
      expect(nativeStyleRuntime.files.has(ownOlderUri)).toBe(false)
    })
    expect(nativeStyleRuntime.files.has(otherMemberUri)).toBe(true)
  })

  // [Codex 7.11 #8] Story CC-7.11 D13: each layer hands accessibility focus back to the control
  // that opened it, never to the top bar Add by default. Native iOS: the opener's handle reaches
  // AccessibilityInfo.setAccessibilityFocus (nativeStyleRuntime.focus) after the layer closes.
  describe('[Codex 7.11 #8] focus returns to the actual opener', () => {
    const TOP_BAR_ADD = 91
    const EMPTY_ADD = 92
    const REPLACE = 93

    /** Maps a testID to a fake native handle for this test only. */
    function handleFor(testID: string, handle: number) {
      nativeStyleRuntime.focusHandles.set(testID, handle)
      onTestFinished(() => {
        nativeStyleRuntime.focusHandles.delete(testID)
      })
    }

    /** A style_piece look the editor reopens exactly: the anchor plus its generated companions. */
    function exactStylePieceLook(garment: GarmentItemContract): SavedLookContract {
      const selection = stylePieceAnchor(garment)!
      const generated = stylePieceLooks(selection, 'warm-rainy', SAMPLE_CATALOG).looks[0]!
      return {
        id: 'hub-focus-look',
        ownerUserId: ACCESS_TOKEN,
        source: 'style_piece',
        lookId: generated.recipe.lookId,
        weather: 'warm-rainy',
        title: null,
        anchorGarmentId: garment.id,
        anchorSnapshot: {
          garmentId: garment.id,
          category: selection.category,
          comfortRange: selection.comfortRange,
        },
        composition: [
          {
            slotIndex: 0,
            category: selection.category,
            kind: 'garment',
            itemId: garment.id,
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
        createdAt: '2026-11-22T00:00:00.000Z',
        updatedAt: '2026-11-22T00:00:00.000Z',
      }
    }

    it('[P1] [Codex 7.11 #8] [7.11-NAT-031] the empty-state Add takes focus back when capture closes', async () => {
      nativeStyleRuntime.enabled = true
      setMobileApplicationUserId('focus-empty-add-owner')
      handleFor('garment-capture-open', TOP_BAR_ADD)
      handleFor('wardrobe-empty-add', EMPTY_ADD)
      renderScreen()
      const emptyAdd = await screen.findByTestId('wardrobe-empty-add')
      await waitFor(() => expect(emptyAdd).toBeVisible())

      await browserUser.click(emptyAdd)
      const capture = await screen.findByTestId('garment-capture-modal')
      nativeStyleRuntime.focus.mockClear()
      await browserUser.click(within(capture).getByTestId('garment-capture-close'))

      await waitFor(() =>
        expect(screen.queryByTestId('garment-capture-modal')).toBeNull()
      )
      await waitFor(() =>
        expect(nativeStyleRuntime.focus).toHaveBeenCalledWith(EMPTY_ADD)
      )
      expect(nativeStyleRuntime.focus).not.toHaveBeenCalledWith(TOP_BAR_ADD)
    })

    it("[P1] [Codex 7.11 #8] [7.11-NAT-031] a failed garment's Replace takes focus back when capture closes", async () => {
      nativeStyleRuntime.enabled = true
      setMobileApplicationUserId('focus-replace-owner')
      handleFor('garment-capture-open', TOP_BAR_ADD)
      server.use(
        http.get('*/api/v1/wardrobe/garments', () =>
          HttpResponse.json({
            data: [garmentFixture({ id: 'focus-failed-piece', status: 'failed' })],
          })
        )
      )
      renderScreen()
      const card = await screen.findByTestId('garment-card-focus-failed-piece')
      await waitFor(() => expect(card).toBeVisible())
      const replace = within(card).getByRole('button', {
        name: getGuestPreviewStrings(i18n.language).firstUse.replaceGarment,
      })
      nativeStyleRuntime.nodeHandles.set(replace, REPLACE)

      await browserUser.click(replace)
      const capture = await screen.findByTestId('garment-capture-modal')
      nativeStyleRuntime.focus.mockClear()
      await browserUser.click(within(capture).getByTestId('garment-capture-close'))

      await waitFor(() =>
        expect(screen.queryByTestId('garment-capture-modal')).toBeNull()
      )
      await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenCalledWith(REPLACE))
      expect(nativeStyleRuntime.focus).not.toHaveBeenCalledWith(TOP_BAR_ADD)
    })

    // Replaces "the editor reopened from a saved look returns focus to that Reopen": CC-7.12 D8
    // moved Reopen to the saved look screen (saved-look-detail.test.tsx); a Closet holding a look
    // the editor reopens exactly shows no Reopen, and the editor hands focus back to the piece's
    // own Style this piece.
    it('[P1] [7.12-NAT-024] [7.11-NAT-031] with a reopenable saved look the Closet shows no Reopen, and the editor returns focus to Style this piece', async () => {
      nativeStyleRuntime.enabled = true
      setMobileApplicationUserId('focus-saved-look-owner')
      const garment = createReadyGarmentFixture({
        id: 'focus-saved-look-piece',
        imageAccess: fixtureWardrobePhoto('#335577'),
      })
      const { handlers } = createSavedLooksMswHandlers([exactStylePieceLook(garment)])
      server.use(
        http.get('*/api/v1/wardrobe/garments', () =>
          HttpResponse.json({ data: [garment] })
        ),
        ...handlers
      )
      renderScreen()
      const opener = await screen.findByTestId('style-piece-open')
      expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
      expect(screen.queryByTestId('saved-look-reopen')).toBeNull()

      await browserUser.click(opener)
      const panel = await screen.findByTestId('style-piece-panel')
      nativeStyleRuntime.focus.mockClear()
      await browserUser.click(within(panel).getByTestId('style-piece-close'))

      await waitFor(() => expect(screen.queryByTestId('style-piece-panel')).toBeNull())
      await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenLastCalledWith(82))
      expect(nativeStyleRuntime.focus).not.toHaveBeenCalledWith(TOP_BAR_ADD)
    })
  })

  describe('7.5 garment cards open the detail', () => {
    const blueTop = {
      ...createReadyGarmentFixture({
        id: 'hub-blue-top',
        imageAccess: fixtureWardrobePhoto('#1e3cc8'),
      }),
      colorFamily: 'blue' as const,
    }
    const plainShoes = {
      ...createReadyGarmentFixture({
        id: 'hub-plain-shoes',
        category: 'shoes',
        material: 'leather',
        imageAccess: fixtureWardrobePhoto('#222222'),
      }),
      colorFamily: null,
    }
    const tagging = { ...garmentFixture({ id: 'hub-tagging' }), colorFamily: null }

    it('[P0] [7.5-NAT-002] labels photos by color plus category and opens only ready cards', async () => {
      setMobileApplicationUserId('hub-detail-owner')
      const colorHeaders: (string | null)[] = []
      server.use(
        http.get('*/api/v1/wardrobe/garments', ({ request }) => {
          colorHeaders.push(request.headers.get('x-couture-garment-color'))
          return HttpResponse.json({ data: [blueTop, plainShoes, tagging] })
        })
      )
      renderScreen()

      const open = await screen.findByTestId('garment-open-hub-blue-top')
      // The closet gate keeps the grid mounted but hidden until every read settles (CC-7.7).
      await waitFor(() => expect(open).toBeVisible())
      expect(colorHeaders.length).toBeGreaterThan(0)
      expect(colorHeaders.every((header) => header === '1')).toBe(true)
      expect(open).toHaveAccessibleName('Blue top')
      expect(
        within(screen.getByTestId('garment-card-hub-blue-top')).getByTestId(
          'garment-card-label'
        ).textContent
      ).toBe('Top · Cotton')
      expect(screen.getByTestId('garment-open-hub-plain-shoes')).toHaveAccessibleName(
        'Shoes'
      )
      // A garment still being tagged keeps its tagging button and opens no detail.
      expect(screen.queryByTestId('garment-open-hub-tagging')).toBeNull()
      await waitFor(() => expect(screen.getByLabelText('Needs tags')).toBeVisible())
      // The raw garment id never shows (2026-11-19 tester report).
      for (const id of [blueTop.id, plainShoes.id, tagging.id]) {
        expect(screen.queryByText(id, { exact: false })).toBeNull()
      }

      press(open)
      expect(routerMock.push).toHaveBeenCalledWith({
        pathname: '/wardrobe-garment',
        params: { id: 'hub-blue-top' },
      })
    })

    it('[P0] [7.5-NAT-010] a pre-save read that lands late cannot undo the post-save reload (Codex P2.6)', async () => {
      setMobileApplicationUserId('hub-detail-owner')
      // Every garment in one answer has the same shape: an opted-in list carries colorFamily.
      const processing = {
        ...garmentFixture({ id: 'hub-processing', status: 'processing' }),
        colorFamily: null,
      }
      const wool = { ...blueTop, material: 'wool' }
      const pollStarted = deferred()
      const poll = deferred()
      // Reads after the held one stay open, so the screen can only show what reads 1 to 3 said.
      const later = deferred()
      let reads = 0
      server.use(
        http.get('*/api/v1/wardrobe/garments', async () => {
          const read = ++reads
          if (read === 2) {
            // An independent status poll reads before the save and answers after it.
            pollStarted.resolve()
            await poll.promise
            return HttpResponse.json({ data: [blueTop, processing] })
          }
          if (read >= 4) await later.promise
          return HttpResponse.json({ data: read === 1 ? [blueTop, processing] : [wool] })
        })
      )
      renderScreen()
      const label = () =>
        within(screen.getByTestId('garment-card-hub-blue-top')).getByTestId(
          'garment-card-label'
        ).textContent
      await screen.findByTestId('garment-card-hub-blue-top')

      try {
        await browserUser.click(
          await screen.findByRole('button', { name: 'Check garment status' })
        )
        await pollStarted.promise
        act(() => notifyWardrobeChanged())
        await waitFor(() => expect(label()).toBe('Top · Wool'))

        poll.resolve()
        // The status poll reads again only after it has consumed the held pre-save answer,
        // so read 4 starting proves that answer settled; it must not have replaced Wool.
        await waitFor(() => expect(reads).toBeGreaterThanOrEqual(4))
        expect(label()).toBe('Top · Wool')
      } finally {
        poll.resolve()
        later.resolve()
      }
    })

    it('[P1] [7.5-NAT-011] a detail save refreshes saved looks so their status follows the tags (Codex P2.7)', async () => {
      setMobileApplicationUserId('hub-detail-owner')
      const { handlers: savedLooksHandlers, store } = createSavedLooksMswHandlers()
      let savedLookReads = 0
      store.onGet = () => {
        savedLookReads += 1
      }
      server.use(
        http.get('*/api/v1/wardrobe/garments', () =>
          HttpResponse.json({ data: [blueTop] })
        ),
        ...savedLooksHandlers
      )
      renderScreen()
      await screen.findByTestId('garment-card-hub-blue-top')
      await waitFor(() => expect(savedLookReads).toBeGreaterThan(0))
      const before = savedLookReads

      act(() => notifyWardrobeChanged())

      await waitFor(() => expect(savedLookReads).toBe(before + 1))
    })

    it('[P0] [7.5-NAT-006] reloads in place when the detail saves tags', async () => {
      setMobileApplicationUserId('hub-detail-owner')
      let reads = 0
      server.use(
        http.get('*/api/v1/wardrobe/garments', () => {
          reads += 1
          return HttpResponse.json({
            data: [reads === 1 ? blueTop : { ...blueTop, material: 'wool' }],
          })
        })
      )
      renderScreen()
      const card = await screen.findByTestId('garment-card-hub-blue-top')
      expect(within(card).getByTestId('garment-card-label').textContent).toBe(
        'Top · Cotton'
      )

      act(() => notifyWardrobeChanged())

      await waitFor(() =>
        expect(
          within(screen.getByTestId('garment-card-hub-blue-top')).getByTestId(
            'garment-card-label'
          ).textContent
        ).toBe('Top · Wool')
      )
      expect(reads).toBe(2)
    })
  })
})
