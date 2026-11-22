// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import React, { useEffect, useRef } from 'react'
import { userEvent as browserUser } from 'vitest/browser'
import type * as ReactNativeModule from 'react-native'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('expo-router', () => ({ router: routerMock }))

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
  holdDismissal: false,
  finishDismissal: undefined as (() => void) | undefined,
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
      return nativeStyleRuntime.focusHandles.get(node.dataset.testid ?? '')
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
      useEffect(() => {
        const previous = wasVisible.current
        wasVisible.current = visible
        if (!nativeStyleRuntime.enabled || previous === visible) return
        if (visible) onShow?.()
        else if (nativeStyleRuntime.platform === 'ios') {
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
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { press } from '@/src/test-utils/press'
import { WardrobeHubScreen } from './wardrobe-hub-screen'

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

function renderScreen(pollOffsetsMs: readonly number[] = [1, 1, 1, 1]) {
  // pollOffsetsMs keeps the still-processing garment poll deterministic and
  // fast in tests instead of paying the real 1s/2s/4s/8s production schedule.
  render(<WardrobeHubScreen pollOffsetsMs={pollOffsetsMs} />)
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
    nativeStyleRuntime.holdDismissal = false
    nativeStyleRuntime.finishDismissal = undefined
    nativeStyleRuntime.state = 'active'
    nativeStyleRuntime.stateListeners.clear()
    routerMock.replace.mockClear()
    routerMock.push.mockClear()
    vi.clearAllMocks()
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

    await screen.findByText(garmentA.id, { exact: true })
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
    await screen.findByText(garmentB.id, { exact: true })
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
    await screen.findByText(garmentA.id, { exact: true })
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
    expect(await screen.findByTestId('style-piece-refresh')).toBeVisible()
    await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenCalledWith(82))
  })

  it('refreshes an unsigned card and retries a failed photo inside the iOS styling panel', async () => {
    nativeStyleRuntime.enabled = true
    setMobileApplicationUserId('style-native-retry-owner')
    const ready = createReadyGarmentFixture({
      id: 'style-native-retry-piece',
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
      await browserUser.click(opener)
      const panel = await screen.findByTestId('style-piece-panel')
      expect(within(panel).getByRole('progressbar')).toHaveTextContent(
        'Checking your photo'
      )
      expect(within(panel).queryByTestId('style-piece-anchor')).toBeNull()
      await waitFor(() => expect(nativeStyleRuntime.focus).toHaveBeenCalledWith(83))
      verification.resolve()

      expect(await within(panel).findByTestId('style-piece-unavailable')).toBeVisible()
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
    } finally {
      verification.resolve()
    }
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
      expect(await screen.findByTestId('garment-tagging-modal')).toBeVisible()
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
      expect(screen.getByText(anchor.id, { exact: true })).toBeVisible()

      await browserUser.click(within(panel).getByTestId('style-piece-refresh'))
      await waitFor(() =>
        expect(screen.queryByText(anchor.id, { exact: true })).toBeNull()
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
      expect(screen.queryByText(anchor.id, { exact: true })).toBeNull()

      poll.resolve()
      await waitFor(() =>
        expect(screen.queryByTestId('garment-status-processing')).toBeNull()
      )
      expect(screen.queryByText(anchor.id, { exact: true })).toBeNull()
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
    await screen.findByTestId('wardrobe-onboarding-card')
    const empty = i18n.t('wardrobe.empty_title')
    expect(screen.queryByText(empty)).toBeNull()
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] }))
    )
    await browserUser.click(retry)

    expect(await screen.findByText(empty)).toBeVisible()
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

    render(<WardrobeHubScreen addEntry />)

    expect(await screen.findByTestId('garment-tagging-modal')).toBeVisible()
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

    render(<WardrobeHubScreen addEntry pollOffsetsMs={[1]} />)

    expect(await screen.findByTestId('garment-status-processing')).toBeVisible()
    expect(screen.queryByTestId('garment-capture-modal')).toBeNull()
    await browserUser.click(screen.getByRole('button', { name: 'Check garment status' }))
    expect(await screen.findByTestId('garment-tagging-modal')).toBeVisible()
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

  it('4.4-MOB-HUB-04 shows the onboarding entry-point card while onboarding is not completed', async () => {
    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-onboarding-card')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('wardrobe-onboarding-card'))
    expect(routerMock.push).toHaveBeenCalledWith('/wardrobe-onboarding')
  })

  it('4.4-MOB-HUB-05 hides the onboarding entry-point card once onboarding is completed', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: {
            ...onboardingNotCompleted,
            status: 'completed',
            currentStep: 'complete',
            // `onboardingStateSchema` sets `completedAt` exactly when the
            // status is `completed`; without it the client rejects the
            // response and the card would stay visible for the wrong reason.
            completedAt: '2026-08-09T00:10:00.000Z',
          },
        })
      )
    )
    renderScreen()
    await waitFor(() => screen.getByTestId('wardrobe-screen'))

    expect(screen.queryByTestId('wardrobe-onboarding-card')).not.toBeInTheDocument()
  })

  it('4.4-MOB-HUB-06 links to the silhouette settings screen', async () => {
    renderScreen()
    await waitFor(() => screen.getByTestId('wardrobe-silhouette-link'))

    fireEvent.click(screen.getByTestId('wardrobe-silhouette-link'))
    expect(routerMock.push).toHaveBeenCalledWith('/wardrobe-silhouette')
  })

  it('4.4-MOB-HUB-07 links to outfit capsules (regression)', async () => {
    renderScreen()
    await waitFor(() => screen.getByTestId('wardrobe-capsules-link'))

    fireEvent.click(screen.getByTestId('wardrobe-capsules-link'))
    expect(routerMock.push).toHaveBeenCalledWith('/wardrobe-capsules')
  })

  it('4.4-MOB-HUB-08 does not let a broken onboarding read hide the garment list (regression)', async () => {
    server.use(http.get('*/api/v1/wardrobe/onboarding', () => HttpResponse.error()))

    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-screen')).toBeInTheDocument()
      expect(screen.queryByTestId('wardrobe-onboarding-card')).not.toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-09 shows a recovery action when the wardrobe session is missing', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    renderScreen()

    expect(await screen.findByTestId('wardrobe-list-retry')).toBeEnabled()
    expect(screen.queryByText(i18n.t('wardrobe.empty_title'))).toBeNull()
    expect(screen.queryByLabelText('Loading wardrobe')).toBeNull()
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
        'AUTHENTICATION_REQUIRED'
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
      expect(screen.getByText('garment-refreshed')).toBeInTheDocument()
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
    expect(await screen.findByTestId('garment-tagging-modal')).toBeVisible()
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
  // two links. A narrow window stands in for the larger text: the actions wrap inside the screen.
  it('6.15-MOB-WRAP-03 wraps the hub actions so Add garment stays inside a narrow screen', async () => {
    await setViewport(260, 896)
    try {
      renderScreen()
      const add = await waitFor(() => screen.getByTestId('garment-capture-open'))
      const screenBox = screen.getByTestId('wardrobe-screen').getBoundingClientRect()
      const addBox = add.getBoundingClientRect()
      // The content is padded 20 on each side.
      expect(addBox.right).toBeLessThanOrEqual(screenBox.right - 20 + 0.5)
      expect(addBox.left).toBeGreaterThanOrEqual(screenBox.left + 20 - 0.5)
    } finally {
      await setViewport(414, 896)
    }
  })
})
