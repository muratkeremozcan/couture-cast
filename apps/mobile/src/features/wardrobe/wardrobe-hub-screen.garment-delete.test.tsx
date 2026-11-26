// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
// Story 7.6 test plan 7.6-NAT-004..007 (and the hub side of 7.6-NAT-002..003): the hub stays
// mounted under the pushed detail and hands the deletion its root status bar. A pending piece
// is hidden; "Deleted" with Undo shows for a deferred delete; Undo inside the window sends
// nothing; the window end, a background, a second delete, a blur that is not a garment card or
// leaving the hub sends the DELETE; a failed send returns the piece, and its "Could not delete"
// with Retry, like the "Deleted" of a confirmed delete or a Retry, waits until no Undo window is
// open; Retry sends each failed piece alone under the bearer read when it is pressed; an answer
// or a notice from the last account says nothing. With no hub mounted the deletion tells other
// screens itself, and Capsules open over the hub reads its capsules again once a delete lands.
// Every case drives a fresh controller on a manual timer.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 (TEA): the hub fills its tab top bar through `navigation.setOptions` (D4), and
// Capsules opens from the Looks tab (D8), so the Closet blurs on that tab switch.
import React from 'react'
import { userEvent as browserUser } from 'vitest/browser'
import type * as ReactNativeModule from 'react-native'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  setParams: vi.fn(),
  dismissTo: vi.fn(),
}))
vi.mock('expo-router', async () => ({
  router: routerMock,
  // Capsules renders its stack header; the header is native chrome.
  Stack: { Screen: () => null },
  // Imported, not importActual'd, so the hub and `screenFocus` share one module instance.
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
  // Story CC-7.11 D4: the hub sets its top bar Add and More through setOptions.
  useNavigation: (await import('../../test-utils/tab-navigation-store.js'))
    .useTabNavigation,
}))
// The Closet More sheet's X imports the icon font, whose native module the browser lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))

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

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    list() {
      const prefix = `${this.uri}/`
      return Array.from(files.keys())
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
      return files.has(this.uri)
    }
    get size() {
      return new TextEncoder().encode(files.get(this.uri) ?? '').length
    }
    textSync() {
      return files.get(this.uri) ?? ''
    }
    write(data: string) {
      files.set(this.uri, data)
    }
    delete() {
      files.delete(this.uri)
    }
  },
  Paths: { cache: 'file:///cache/', document: 'file:///documents' },
}))

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))

// The app's AppState, driven by the test: `change` listeners are kept here so a case can send
// the app to the background.
const appState = vi.hoisted(() => ({
  state: 'active' as ReactNativeModule.AppStateStatus,
  listeners: new Set<(state: ReactNativeModule.AppStateStatus) => void>(),
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AppState: {
      get currentState() {
        return appState.state
      },
      addEventListener: (
        event: ReactNativeModule.AppStateEvent,
        listener: (state: ReactNativeModule.AppStateStatus) => void
      ) => {
        if (event !== 'change') return actual.AppState.addEventListener(event, listener)
        appState.listeners.add(listener)
        return {
          remove: () => {
            appState.listeners.delete(listener)
          },
        }
      },
    },
  }
})

import { View } from 'react-native'
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import {
  createDeferredGarmentDeletion,
  SAVE_FEEDBACK_TIMINGS,
  type DeferredGarmentDeletionEvent,
  type DeferredGarmentDeletionTimer,
  type StatusBarNoticeInput,
} from '@couture/utils'
import {
  reportNetworkOnline,
  SaveFeedbackProvider,
  useStatusBar,
} from '@/components/save-feedback'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  resolveMobileAccessToken,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { notifyWardrobeChanged, onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { server } from '@/src/test-utils/msw/server'
import { tabNavigation } from '@/src/test-utils/tab-navigation'
import WardrobeCapsulesScreen from '../../../app/wardrobe-capsules'
import {
  createMobileGarmentDeletion,
  resetGarmentDeletionForTests,
  type GarmentDeleteMode,
  type GarmentDeletionPresenter,
  type MobileGarmentDeletion,
  type MobileGarmentDeletionDependencies,
} from './garment-deletion'
import { WardrobeHubScreen } from './wardrobe-hub-screen'

const owner = 'hub-delete-owner'
/** The account the app holds after a sign-out and a sign-in as someone else. */
const secondMember = 'hub-delete-second-member'
const windowMs = SAVE_FEEDBACK_TIMINGS.statusBarDurationMs
/** The longest delay `setTimeout` takes: a notice timer that never fires during a case. */
const NEVER_ON_REAL_TIME_MS = 2_147_483_647

function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken(owner)
const BEARER = `Bearer ${ACCESS_TOKEN}`
/** The same member's bearer after a session refresh. */
const REFRESHED_TOKEN = `${ACCESS_TOKEN}-refreshed`
const REFRESHED_BEARER = `Bearer ${REFRESHED_TOKEN}`
const SECOND_TOKEN = fakeAccessToken(secondMember)
const SECOND_BEARER = `Bearer ${SECOND_TOKEN}`

function photo(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return { url: canvas.toDataURL('image/png'), expiresAt: '2099-12-31T00:00:00.000Z' }
}

const blueTop = {
  ...createReadyGarmentFixture({ id: 'delete-blue-top', imageAccess: photo('#1e3cc8') }),
  colorFamily: 'blue' as const,
}
const plainShoes = {
  ...createReadyGarmentFixture({
    id: 'delete-plain-shoes',
    category: 'shoes',
    material: 'leather',
    imageAccess: photo('#222222'),
  }),
  colorFamily: null,
}

const greenScarf = {
  ...createReadyGarmentFixture({
    id: 'delete-green-scarf',
    imageAccess: photo('#2e8b57'),
  }),
  colorFamily: null,
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

/**
 * A manual timer for the deletion controller. `advance` runs the live timers due by then one at a
 * time, earliest first (ties in the order they were set): it moves the clock to each timer's due
 * time before running it, so a timer a callback clears never runs and one it sets is due from
 * that moment. The same implementation lives in the hub and detail suites.
 */
function createManualTimer() {
  let now = 0
  let nextHandle = 1
  const scheduled = new Map<number, { at: number; callback: () => void }>()
  const timer: DeferredGarmentDeletionTimer = {
    setTimeout: (callback, ms) => {
      const handle = nextHandle++
      scheduled.set(handle, { at: now + ms, callback })
      return handle
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number)
    },
  }
  const nextDue = (until: number) =>
    [...scheduled.entries()]
      .filter(([, entry]) => entry.at <= until)
      .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
  const advance = (ms: number) => {
    const until = now + ms
    for (let due = nextDue(until); due; due = nextDue(until)) {
      const [handle, entry] = due
      scheduled.delete(handle)
      now = entry.at
      entry.callback()
    }
    now = until
  }
  return { timer, advance, active: () => scheduled.size, now: () => now }
}

/** The hub's ScrollView: the nearest ancestor of the grid that scrolls vertically. */
function scrollContainerOf(element: HTMLElement): HTMLElement {
  let node = element.parentElement
  while (node && !/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) {
    node = node.parentElement
  }
  if (!node) throw new Error('The garment grid has no scrolling ancestor.')
  return node
}

const card = (id: string) => screen.queryByTestId(`garment-card-${id}`)
const bar = () => screen.getByTestId('status-feedback-bar')
const noBar = () => screen.queryByTestId('status-feedback-bar')
const sentDelete = (id: string, authorization = BEARER) => ({ id, authorization })
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)

const ok = () => new HttpResponse(null, { status: 204 })
const serverError = () =>
  HttpResponse.json(
    { statusCode: 500, message: 'Internal server error' },
    { status: 500 }
  )

/** A gate a handler awaits, so a test decides when the answer lands. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

/** A bearer read a test answers when it chooses. */
function heldBearerRead() {
  let answer!: (token: string) => void
  const read = new Promise<string>((resolve) => {
    answer = resolve
  })
  return { read, answer }
}

/**
 * Wraps a deletion so a test keeps every notice the deletion showed, with its actions, the way
 * the root status bar received it. A test can then press an action the bar no longer shows.
 */
function recordingNotices(real: MobileGarmentDeletion) {
  const notices: StatusBarNoticeInput[] = []
  const deletion: MobileGarmentDeletion = {
    ...real,
    attach(hub) {
      return real.attach({
        ...hub,
        presenter: {
          ...hub.presenter,
          showNotice: (input) => {
            notices.push(input)
            return hub.presenter.showNotice(input)
          },
        },
      })
    },
  }
  return { deletion, notices }
}

const scheduledEvent = (id: string) => ({ type: 'scheduled', id }) as const
const committingEvent = (id: string) => ({ type: 'committing', id }) as const
const committedEvent = (id: string) => ({ type: 'committed', id }) as const
const failedEvent = (id: string) => ({ type: 'failed', id, error: expect.any(Error) })
const undoneEvent = (id: string) => ({ type: 'undone', id }) as const
/** The controller releases these failures for their "Could not delete" notice. */
const reportEvent = (...ids: string[]) => ({
  type: 'failuresToReport',
  failures: ids.map((id) => ({ id, error: expect.any(Error) })),
})

/** The root status bar as another feature on the screen holds it. */
const otherFeature: { bar: ReturnType<typeof useStatusBar> | null } = { bar: null }
function OtherFeatureOnTheBar() {
  otherFeature.bar = useStatusBar()
  return null
}

const FAILED = 'Could not delete this piece.'
const FAILED_WITH_RETRY = `${FAILED}Retry`

describe('WardrobeHubScreen garment delete (Story 7.6)', () => {
  let closet: Record<string, unknown>[]
  let deletes: { id: string; authorization: string | null }[]
  let listReads: (string | null)[]
  /** A closet read answers once this settles, with the closet as it was when it arrived. */
  let listHeld: Promise<void>
  let deleteReply: (garmentId: string) => Response | Promise<Response>
  let changes: number
  let stopWatching: () => void
  let restoreToken: () => void
  let clock: ReturnType<typeof createManualTimer>
  /** The status bar's notice timer, apart from the controller clock. */
  let noticeClock: ReturnType<typeof createManualTimer>
  let deletion: MobileGarmentDeletion
  let events: DeferredGarmentDeletionEvent[]
  /** Every deletion a case built, reset and disposed after it. */
  let built: MobileGarmentDeletion[]
  /** Every notice the root status bar announced, in order (one entry per notice shown). */
  let announced: string[]
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  /**
   * The root status bar provider around a phone-height frame, so the hub's ScrollView scrolls
   * like the real screen. Without the hub the provider stays mounted, as the root one does when
   * the closet tab leaves. `capsules` mounts the Capsules route pushed over the hub.
   */
  function hubTree(hub: MobileGarmentDeletion | null, capsules = false) {
    return (
      <SaveFeedbackProvider onAnnounce={(entry) => announced.push(entry.message)}>
        <OtherFeatureOnTheBar />
        <View style={{ height: 600 }}>
          {hub ? <WardrobeHubScreen pollOffsetsMs={[1, 1, 1, 1]} deletion={hub} /> : null}
        </View>
        {capsules ? <WardrobeCapsulesScreen /> : null}
      </SaveFeedbackProvider>
    )
  }

  function renderHub(hub: MobileGarmentDeletion = deletion) {
    return render(hubTree(hub))
  }

  /**
   * The root status bar's own timer clears a notice on real time, so a slow worker could take
   * Undo off the bar while the controller window is still open. Each notice is shown with a
   * duration that never ends on real time, and leaves the bar when `noticeClock` reaches its own
   * duration; only a case that advances `noticeClock` expires a notice. The notice keeps its id,
   * so the hub reports the real id to `observeBar`, and the deletion hears the notice's own
   * duration, which it measures on `noticeClock` too (`now`).
   */
  function withNoticeExpiryOnTestClock(
    presenter: GarmentDeletionPresenter
  ): GarmentDeletionPresenter {
    return {
      ...presenter,
      showNotice: (input) => {
        const shown = presenter.showNotice({
          ...input,
          durationMs: NEVER_ON_REAL_TIME_MS,
        })
        const durationMs = input.durationMs ?? SAVE_FEEDBACK_TIMINGS.statusBarDurationMs
        noticeClock.timer.setTimeout(() => presenter.dismissNotice(shown.id), durationMs)
        return { id: shown.id, durationMs }
      },
    }
  }

  /**
   * A deletion on the manual timer whose controller events land in `events`, and whose notices
   * expire on `noticeClock`. It hears the real identity store until the case ends and disposes
   * it.
   */
  function createDeletion(dependencies: Partial<MobileGarmentDeletionDependencies> = {}) {
    const created = createMobileGarmentDeletion(
      createDeferredGarmentDeletion({ timer: clock.timer }),
      { now: () => noticeClock.now(), ...dependencies }
    )
    created.controller.subscribe((event) => {
      events.push(event)
    })
    built.push(created)
    return {
      ...created,
      attach: (hub) =>
        created.attach({ ...hub, presenter: withNoticeExpiryOnTestClock(hub.presenter) }),
    } satisfies MobileGarmentDeletion
  }

  /** What the detail does after Delete: it requests the delete, then pops to the hub. */
  function requestDelete(
    id: string,
    mode: GarmentDeleteMode = 'deferred',
    accessToken = ACCESS_TOKEN
  ) {
    act(() => deletion.request(id, mode, accessToken))
  }

  function advance(ms: number) {
    act(() => clock.advance(ms))
  }

  /** Real time passing for the status bar's notices only. */
  function advanceNotices(ms: number) {
    act(() => noticeClock.advance(ms))
  }

  function changeAppState(state: ReactNativeModule.AppStateStatus) {
    act(() => {
      appState.state = state
      for (const listener of [...appState.listeners]) listener(state)
    })
  }

  /** A tab press away from the Closet (false) or back to it (true). */
  function setHubFocus(focused: boolean) {
    act(() => screenFocus.set(focused))
  }

  /** Sign-out and sign-in as another member: the hub remounts for the new account. */
  async function switchAccount() {
    const readsBefore = listReads.length
    act(() => setMobileApplicationUserId(secondMember))
    await waitFor(() => expect(listReads).toHaveLength(readsBefore + 1))
    await screen.findByTestId('wardrobe-screen')
  }

  async function renderLoadedHub(hub: MobileGarmentDeletion = deletion) {
    const view = renderHub(hub)
    await screen.findByTestId(`garment-card-${blueTop.id}`)
    // Story CC-7.7: the grid shows once the Closet gate's reads (inventory, onboarding) settle.
    await waitFor(() => expect(card(plainShoes.id)).toBeVisible())
    return view
  }

  const retryButton = () => within(bar()).getByRole('button', { name: 'Retry' })
  const undoButton = () => within(bar()).getByRole('button', { name: 'Undo' })

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreToken = setMobileAccessTokenResolver(() => ACCESS_TOKEN)
    setMobileApplicationUserId(owner)
    reportNetworkOnline()
    screenFocus.reset()
    closet = [blueTop, plainShoes]
    deletes = []
    listReads = []
    listHeld = Promise.resolve()
    deleteReply = ok
    changes = 0
    stopWatching = onWardrobeChanged(() => {
      changes++
    })
    appState.state = 'active'
    clock = createManualTimer()
    noticeClock = createManualTimer()
    events = []
    built = []
    announced = []
    deletion = createDeletion()
    server.use(
      http.get('*/api/v1/wardrobe/garments', async ({ request }) => {
        listReads.push(request.headers.get('authorization'))
        const snapshot = closet
        await listHeld
        return HttpResponse.json({ data: snapshot })
      }),
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: onboardingNotCompleted })
      ),
      http.delete('*/api/v1/wardrobe/garments/:garmentId', ({ request, params }) => {
        const id = String(params.garmentId)
        deletes.push({ id, authorization: request.headers.get('authorization') })
        return deleteReply(id)
      })
    )
  })

  afterEach(() => {
    // Drop pending deletes before the hub unmounts, so its unmount flush sends nothing.
    for (const instance of built) {
      instance.reset()
      instance.dispose()
    }
    resetGarmentDeletionForTests()
    screenFocus.reset()
    tabNavigation.reset()
    stopWatching()
    restoreToken()
    setMobileApplicationUserId(null)
    reportNetworkOnline()
    appState.state = 'active'
    files.clear()
    vi.clearAllMocks()
    if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
    else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('[P0] [7.6-NAT-004] hides the piece with Deleted and Undo; Undo inside the window sends no DELETE and brings it back with Undone', async () => {
    await renderLoadedHub()
    const changesBefore = changes

    requestDelete(blueTop.id)

    expect(card(blueTop.id)).toBeNull()
    expect(card(plainShoes.id)).toBeVisible()
    expect(bar().textContent).toBe('DeletedUndo')

    advance(windowMs - 1)
    await browserUser.click(undoButton())

    await waitFor(() => expect(bar().textContent).toBe('Undone'))
    expect(card(blueTop.id)).toBeVisible()
    advance(windowMs)
    expect(events).toEqual([scheduledEvent(blueTop.id), undoneEvent(blueTop.id)])
    expect(clock.active()).toBe(0)
    expect(deletes).toEqual([])
    expect(changes).toBe(changesBefore)
  })

  it('[P1] [7.6-NAT-004] the Undo notice leaves the bar only when its own duration passes; the window still ends on the controller clock', async () => {
    await renderLoadedHub()
    requestDelete(blueTop.id)

    advanceNotices(windowMs - 1)
    expect(bar().textContent).toBe('DeletedUndo')

    advanceNotices(1)

    expect(noBar()).toBeNull()
    expect(clock.active()).toBe(1)
    expect(events).toEqual([scheduledEvent(blueTop.id)])
    expect(deletes).toEqual([])

    advance(windowMs)

    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P0] [7.6-NAT-004] the window end sends exactly one DELETE, and not a millisecond sooner', async () => {
    await renderLoadedHub()

    requestDelete(blueTop.id)
    advance(windowMs - 1)

    expect(events).toEqual([scheduledEvent(blueTop.id)])
    expect(card(blueTop.id)).toBeNull()

    advance(1)

    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(card(blueTop.id)).toBeNull()
    expect(card(plainShoes.id)).toBeVisible()
    advance(windowMs)
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P0] [7.6-NAT-005] a failed send returns the piece with Retry; Retry reads the bearer when pressed, sends once at once and shows Deleted', async () => {
    deleteReply = serverError
    await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id)

    advance(windowMs)

    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(card(blueTop.id)).toBeVisible()
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      committingEvent(blueTop.id),
      failedEvent(blueTop.id),
      reportEvent(blueTop.id),
    ])
    expect(changes).toBe(changesBefore)

    // The session refreshes after the hub's last closet read, and the hub reads nothing again:
    // only a bearer read at the press can carry the new token.
    restoreToken()
    restoreToken = setMobileAccessTokenResolver(() => REFRESHED_TOKEN)
    expect(new Set(listReads)).toEqual(new Set([BEARER]))
    const changesBeforeRetry = changes
    deleteReply = ok
    await browserUser.click(retryButton())

    // Retry opens no new Undo window and sends under the bearer read at the press.
    expect(clock.active()).toBe(0)
    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id, REFRESHED_BEARER),
    ])
    expect(card(blueTop.id)).toBeNull()
    expect(events.slice(4)).toEqual([
      committingEvent(blueTop.id),
      committedEvent(blueTop.id),
    ])
    expect(changes).toBe(changesBeforeRetry + 1)
    expect(new Set(listReads)).toEqual(new Set([BEARER]))
  })

  it('[P0] [7.6-NAT-006] going to the background inside the window sends the DELETE at once', async () => {
    await renderLoadedHub()
    requestDelete(blueTop.id)

    changeAppState('inactive')
    expect(events).toEqual([scheduledEvent(blueTop.id)])

    changeAppState('background')

    expect(clock.active()).toBe(0)
    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(card(blueTop.id)).toBeNull()
  })

  it('[P0] [7.6-NAT-006] a second delete inside the window sends the first at once; Undo then applies to the second only', async () => {
    await renderLoadedHub()
    requestDelete(blueTop.id)

    requestDelete(plainShoes.id)

    expect(card(blueTop.id)).toBeNull()
    expect(card(plainShoes.id)).toBeNull()
    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        scheduledEvent(plainShoes.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(bar().textContent).toBe('DeletedUndo')

    await browserUser.click(undoButton())

    await waitFor(() => expect(card(plainShoes.id)).toBeVisible())
    expect(card(blueTop.id)).toBeNull()
    advance(windowMs)
    expect(events.slice(4)).toEqual([undoneEvent(plainShoes.id)])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P1] [7.6-NAT-006] leaving the hub inside the window sends the DELETE at once', async () => {
    const view = await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id)

    view.unmount()

    expect(clock.active()).toBe(0)
    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    // With no hub mounted, the deletion itself tells the other screens, once.
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P0] [7.6-NAT-006] a tab switch away from the mounted hub inside the window sends the DELETE at once', async () => {
    await renderLoadedHub()
    requestDelete(blueTop.id)
    expect(clock.active()).toBe(1)

    setHubFocus(false)

    // The hub is still mounted under the other tab; only the blur sent the delete.
    expect(screen.getByTestId('wardrobe-screen')).toBeInTheDocument()
    expect(clock.active()).toBe(0)
    expect(events).toEqual([scheduledEvent(blueTop.id), committingEvent(blueTop.id)])
    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    advance(windowMs)
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P0] [7.6-NAT-006] opening a garment card blurs the hub without sending the delete; after the pop a tab switch sends it', async () => {
    await renderLoadedHub()
    requestDelete(blueTop.id)

    await browserUser.click(screen.getByTestId(`garment-open-${plainShoes.id}`))
    setHubFocus(false)

    // The detail pushed over the hub is still the Closet: the Undo window keeps running.
    expect(routerMock.push).toHaveBeenCalledTimes(1)
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/wardrobe-garment',
      params: { id: plainShoes.id },
    })
    expect(clock.active()).toBe(1)
    expect(events).toEqual([scheduledEvent(blueTop.id)])
    expect(deletes).toEqual([])

    // The detail pops back; the next blur is a tab switch.
    setHubFocus(true)
    expect(clock.active()).toBe(1)
    setHubFocus(false)

    expect(clock.active()).toBe(0)
    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P1] [7.6-NAT-003] a confirmed delete hides the piece while it sends, then shows Deleted without Undo', async () => {
    await renderLoadedHub()
    const changesBefore = changes

    requestDelete(blueTop.id, 'immediate')

    expect(card(blueTop.id)).toBeNull()
    expect(clock.active()).toBe(0)
    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(events).toEqual([committingEvent(blueTop.id), committedEvent(blueTop.id)])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P1] [7.6-NAT-003] a piece already gone sends one DELETE at once and shows Deleted once it lands', async () => {
    const answer = gate()
    deleteReply = async () => {
      await answer.opened
      return ok()
    }
    await renderLoadedHub()
    const changesBefore = changes

    requestDelete(blueTop.id, 'gone')

    expect(card(blueTop.id)).toBeNull()
    expect(clock.active()).toBe(0)
    expect(events).toEqual([committingEvent(blueTop.id)])
    await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
    // Nothing is announced before the DELETE answers.
    expect(noBar()).toBeNull()

    answer.open()

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(events).toEqual([committingEvent(blueTop.id), committedEvent(blueTop.id)])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(card(blueTop.id)).toBeNull()
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P0] [7.6-NAT-003] a confirmed delete sends the delete still inside its window first, then its own, each once', async () => {
    await renderLoadedHub()
    requestDelete(plainShoes.id)

    requestDelete(blueTop.id, 'immediate')

    // The controller starts each DELETE right after its committing event, so this order is
    // the send order: the waiting piece first, then the confirmed one.
    expect(events).toEqual([
      scheduledEvent(plainShoes.id),
      committingEvent(plainShoes.id),
      committingEvent(blueTop.id),
    ])
    expect(clock.active()).toBe(0)
    expect(card(plainShoes.id)).toBeNull()
    expect(card(blueTop.id)).toBeNull()
    await waitFor(() => expect(events).toHaveLength(5))
    // The two answers may land in either order.
    expect(events.slice(3)).toEqual(
      expect.arrayContaining([committedEvent(blueTop.id), committedEvent(plainShoes.id)])
    )
    expect([...deletes].sort(byId)).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
    ])
    advance(windowMs)
    expect(deletes).toHaveLength(2)
  })

  it('[P0] [7.6-NAT-004] a second request for a piece already inside its window changes nothing; one DELETE at the window end', async () => {
    await renderLoadedHub()
    requestDelete(blueTop.id)

    requestDelete(blueTop.id)
    requestDelete(blueTop.id, 'immediate')

    expect(events).toEqual([scheduledEvent(blueTop.id)])
    expect(clock.active()).toBe(1)
    expect(bar().textContent).toBe('DeletedUndo')

    advance(windowMs)

    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  /** Starts a deferred delete, ends its window, and waits until its DELETE is out. */
  async function sendHeldDelete() {
    requestDelete(blueTop.id)
    advance(windowMs)
    await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
    // The bar still offers the Undo it showed when the window opened.
    expect(bar().textContent).toBe('DeletedUndo')
  }

  it('[P0] [7.6-NAT-004] Undo tapped while the DELETE is out shows nothing new; a 500 answer then says Could not delete with Retry, never Deleted', async () => {
    const answer = gate()
    deleteReply = async () => {
      await answer.opened
      return serverError()
    }
    await renderLoadedHub()
    await sendHeldDelete()
    const announcedBefore = announced.length

    await browserUser.click(undoButton())

    // The tap closes the Undo notice and nothing replaces it until the answer lands.
    await waitFor(() => expect(noBar()).toBeNull())
    expect(announced.slice(announcedBefore)).toEqual([])
    expect(card(blueTop.id)).toBeNull()

    answer.open()

    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(announced.slice(announcedBefore)).toEqual([FAILED])
    expect(card(blueTop.id)).toBeVisible()
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      committingEvent(blueTop.id),
      failedEvent(blueTop.id),
      reportEvent(blueTop.id),
    ])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P0] [7.6-NAT-004] Undo tapped while the DELETE is out shows nothing new; a 204 answer then says Deleted once', async () => {
    const answer = gate()
    deleteReply = async () => {
      await answer.opened
      return ok()
    }
    await renderLoadedHub()
    const changesBefore = changes
    await sendHeldDelete()
    const announcedBefore = announced.length

    await browserUser.click(undoButton())

    await waitFor(() => expect(noBar()).toBeNull())
    expect(announced.slice(announcedBefore)).toEqual([])

    answer.open()

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    expect(card(blueTop.id)).toBeNull()
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      committingEvent(blueTop.id),
      committedEvent(blueTop.id),
    ])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P0] [7.6-NAT-004] Undo tapped after the delete committed says Deleted without Undo and the piece stays gone', async () => {
    await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id)
    advance(windowMs)
    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(changes).toBe(changesBefore + 1)
    // A deferred commit announces nothing new: the window's Undo notice is still up.
    expect(bar().textContent).toBe('DeletedUndo')
    const announcedBefore = announced.length

    await browserUser.click(undoButton())

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(within(bar()).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    expect(card(blueTop.id)).toBeNull()
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P0] [7.6-NAT-005] answers for deletes requested under the last account neither change the grid nor show a notice', async () => {
    const answer = gate()
    const replies: Record<string, () => Response> = {
      [blueTop.id]: ok,
      [plainShoes.id]: serverError,
    }
    deleteReply = async (id) => {
      await answer.opened
      return replies[id]!()
    }
    await renderLoadedHub()
    requestDelete(blueTop.id, 'immediate')
    requestDelete(plainShoes.id, 'immediate')
    await waitFor(() =>
      expect([...deletes].sort(byId)).toEqual([
        sentDelete(blueTop.id),
        sentDelete(plainShoes.id),
      ])
    )
    const changesBefore = changes

    // The next account signs in with its own token.
    restoreToken()
    restoreToken = setMobileAccessTokenResolver(() => SECOND_TOKEN)
    await switchAccount()
    expect(listReads.at(-1)).toBe(SECOND_BEARER)
    answer.open()

    // One answer succeeds and one fails, in either order; the failure is released for its
    // notice at once because no Undo window is open.
    await waitFor(() => expect(events).toHaveLength(5))
    expect(events.slice(2)).toEqual(
      expect.arrayContaining([
        committedEvent(blueTop.id),
        failedEvent(plainShoes.id),
        reportEvent(plainShoes.id),
      ])
    )
    expect(noBar()).toBeNull()
    expect(announced).toEqual([])
    expect(changes).toBe(changesBefore)
    // The new account's hub removed nothing: both pieces show once nothing is pending.
    await waitFor(() => expect(card(blueTop.id)).toBeVisible())
    expect(card(plainShoes.id)).toBeVisible()
    expect(deletes).toHaveLength(2)

    // A delete requested under the account the app holds now does reach the hub.
    deleteReply = ok
    requestDelete(blueTop.id, 'immediate', SECOND_TOKEN)

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(announced).toEqual(['Deleted'])
    expect(card(blueTop.id)).toBeNull()
    expect(deletes).toHaveLength(3)
    expect(deletes.at(-1)).toEqual(sentDelete(blueTop.id, SECOND_BEARER))
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P1] [7.6-NAT-005] a delete driven on the controller directly (no recorded epoch) only hides the piece while pending and shows no notice', async () => {
    const commit = vi.fn().mockResolvedValue(undefined)
    await renderLoadedHub()
    const changesBefore = changes

    act(() => {
      deletion.controller.schedule(blueTop.id, commit)
    })

    // The hidden set still follows the controller.
    expect(card(blueTop.id)).toBeNull()
    expect(noBar()).toBeNull()

    advance(windowMs)

    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(commit).toHaveBeenCalledTimes(1)
    // No committed event reached the hub, so it neither removes the piece nor tells anyone.
    await waitFor(() => expect(card(blueTop.id)).toBeVisible())
    expect(noBar()).toBeNull()
    expect(announced).toEqual([])
    expect(changes).toBe(changesBefore)
    expect(deletes).toEqual([])
  })

  it('[P0] [7.6-NAT-005] a failure while another delete is inside its window keeps that Undo on the bar until its deadline; Could not delete shows once it sends', async () => {
    const replies: Record<string, () => Response> = {
      [blueTop.id]: serverError,
      [plainShoes.id]: ok,
    }
    deleteReply = (id) => replies[id]!()
    await renderLoadedHub()
    requestDelete(blueTop.id)

    // The second delete sends the first at once, and the first fails inside the second's window.
    requestDelete(plainShoes.id)

    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        scheduledEvent(plainShoes.id),
        failedEvent(blueTop.id),
      ])
    )
    // The failed piece is back at once; its notice waits behind the live Undo.
    await waitFor(() => expect(card(blueTop.id)).toBeVisible())
    expect(card(plainShoes.id)).toBeNull()
    expect(bar().textContent).toBe('DeletedUndo')
    expect(undoButton()).toBeInTheDocument()
    expect(announced).toEqual(['Deleted', 'Deleted'])

    advance(windowMs - 1)
    expect(events).toHaveLength(4)
    expect(bar().textContent).toBe('DeletedUndo')

    advance(1)

    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    await waitFor(() => expect(events).toHaveLength(7))
    expect(events.slice(4)).toEqual([
      committingEvent(plainShoes.id),
      reportEvent(blueTop.id),
      committedEvent(plainShoes.id),
    ])
    expect(announced).toEqual(['Deleted', 'Deleted', FAILED])
    expect(deletes).toEqual([sentDelete(blueTop.id), sentDelete(plainShoes.id)])
    expect(card(blueTop.id)).toBeVisible()
    expect(card(plainShoes.id)).toBeNull()
  })

  it('[P0] [7.6-NAT-005] Undo of the waiting delete releases the failure notice; Retry sends the failed piece alone while a new window keeps running', async () => {
    const bearerRead = heldBearerRead()
    const resolveAccessToken = vi.fn(() => bearerRead.read)
    deletion = createDeletion({ resolveAccessToken })
    const blueReplies = [serverError, serverError]
    const replies: Record<string, () => Response> = {
      [blueTop.id]: () => blueReplies.shift()!(),
      [plainShoes.id]: ok,
    }
    deleteReply = (id) => replies[id]!()
    await renderLoadedHub()
    requestDelete(blueTop.id)
    requestDelete(plainShoes.id)
    await waitFor(() => expect(events).toContainEqual(failedEvent(blueTop.id)))
    expect(bar().textContent).toBe('DeletedUndo')

    await browserUser.click(undoButton())

    // No window is open once the shoes are undone, so the failure shows at once.
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(events.slice(3)).toEqual([
      failedEvent(blueTop.id),
      undoneEvent(plainShoes.id),
      reportEvent(blueTop.id),
    ])
    expect(announced).toEqual(['Deleted', 'Deleted', 'Undone', FAILED])
    expect(card(plainShoes.id)).toBeVisible()

    await browserUser.click(retryButton())
    expect(resolveAccessToken).toHaveBeenCalledTimes(1)

    // While Retry reads the bearer, the member deletes the shoes again.
    requestDelete(plainShoes.id)
    expect(bar().textContent).toBe('DeletedUndo')
    await act(async () => {
      bearerRead.answer(REFRESHED_TOKEN)
      await bearerRead.read
    })

    // Retry sends the top alone; the shoes keep their window and their Undo.
    expect(clock.active()).toBe(1)
    expect(events.slice(6)).toEqual([
      scheduledEvent(plainShoes.id),
      committingEvent(blueTop.id),
    ])
    await waitFor(() => expect(events).toHaveLength(9))
    expect(events.at(-1)).toEqual(failedEvent(blueTop.id))
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id, REFRESHED_BEARER),
    ])
    expect(bar().textContent).toBe('DeletedUndo')
    expect(card(plainShoes.id)).toBeNull()

    // The second failure of the top waits for the shoes' deadline, like the first.
    advance(windowMs)

    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    await waitFor(() => expect(events).toHaveLength(12))
    expect(events.slice(9)).toEqual([
      committingEvent(plainShoes.id),
      reportEvent(blueTop.id),
      committedEvent(plainShoes.id),
    ])
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id, REFRESHED_BEARER),
      sentDelete(plainShoes.id),
    ])
    expect(resolveAccessToken).toHaveBeenCalledTimes(1)
  })

  it('[P0] [7.6-NAT-005] two failures share one Could not delete notice whose Retry sends every failed piece once', async () => {
    deleteReply = serverError
    await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id)
    requestDelete(plainShoes.id)
    await waitFor(() => expect(events).toContainEqual(failedEvent(blueTop.id)))

    advance(windowMs)

    await waitFor(() => expect(events).toHaveLength(8))
    expect(events.slice(4)).toEqual([
      committingEvent(plainShoes.id),
      reportEvent(blueTop.id),
      failedEvent(plainShoes.id),
      reportEvent(plainShoes.id),
    ])
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(within(bar()).getAllByRole('button')).toHaveLength(1)
    // The second failure replaced the first notice with one that carries both pieces.
    expect(announced).toEqual(['Deleted', 'Deleted', FAILED, FAILED])
    expect(card(blueTop.id)).toBeVisible()
    expect(card(plainShoes.id)).toBeVisible()
    deleteReply = ok

    await browserUser.click(retryButton())

    await waitFor(() => expect(events).toHaveLength(12))
    expect(events.slice(8, 10)).toEqual([
      committingEvent(blueTop.id),
      committingEvent(plainShoes.id),
    ])
    expect(events.slice(10)).toEqual(
      expect.arrayContaining([committedEvent(blueTop.id), committedEvent(plainShoes.id)])
    )
    expect(clock.active()).toBe(0)
    expect(deletes).toHaveLength(4)
    expect(deletes.slice(0, 2)).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
    ])
    // Both retried sends start on the one tap, so they may reach the server in either order.
    expect([...deletes.slice(2)].sort(byId)).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
    ])
    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(card(blueTop.id)).toBeNull()
    expect(card(plainShoes.id)).toBeNull()
    expect(changes).toBe(changesBefore + 2)
  })

  /**
   * A confirmed delete of the top fails, its Retry is held at the server, the member starts a
   * deferred delete of the shoes, and the Retry answers 204 inside the shoes' window.
   */
  async function landRetryInsideNewWindow(shoesReply: () => Response) {
    const retryAnswer = gate()
    const blueReplies: (() => Response | Promise<Response>)[] = [
      serverError,
      async () => {
        await retryAnswer.opened
        return ok()
      },
    ]
    const replies: Record<string, () => Response | Promise<Response>> = {
      [blueTop.id]: () => blueReplies.shift()!(),
      [plainShoes.id]: shoesReply,
    }
    deleteReply = (id) => replies[id]!()
    await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    await browserUser.click(retryButton())
    await waitFor(() => expect(deletes).toHaveLength(2))
    requestDelete(plainShoes.id)
    expect(bar().textContent).toBe('DeletedUndo')
    const announcedBefore = announced.length

    retryAnswer.open()

    await waitFor(() => expect(events).toContainEqual(committedEvent(blueTop.id)))
    // The top is gone and the other screens heard it, but its Deleted waits for the window.
    expect(card(blueTop.id)).toBeNull()
    expect(changes).toBe(changesBefore + 1)
    expect(bar().textContent).toBe('DeletedUndo')
    expect(announced.slice(announcedBefore)).toEqual([])
    expect(clock.active()).toBe(1)
    return { changesBefore, announcedBefore }
  }

  it('[P0] [7.6-NAT-005] a Retry that lands inside a new Undo window keeps that Undo on the bar; Deleted shows once the window ends', async () => {
    const { changesBefore, announcedBefore } = await landRetryInsideNewWindow(ok)

    advance(windowMs - 1)
    expect(bar().textContent).toBe('DeletedUndo')

    advance(1)

    // The window closed as the shoes' send started: the held Deleted shows now.
    expect(bar().textContent).toBe('Deleted')
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    await waitFor(() => expect(events.at(-1)).toEqual(committedEvent(plainShoes.id)))
    expect(bar().textContent).toBe('Deleted')
    // A deferred commit announces nothing of its own.
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
    ])
    expect(changes).toBe(changesBefore + 2)
  })

  it('[P0] [7.6-NAT-005] a Retry that lands inside a new Undo window whose send then fails shows Deleted first and ends on Could not delete with Retry', async () => {
    const { changesBefore, announcedBefore } = await landRetryInsideNewWindow(serverError)

    advance(windowMs)

    expect(bar().textContent).toBe('Deleted')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(announced.slice(announcedBefore)).toEqual(['Deleted', FAILED])
    expect(events.slice(-3)).toEqual([
      committingEvent(plainShoes.id),
      failedEvent(plainShoes.id),
      reportEvent(plainShoes.id),
    ])
    expect(card(plainShoes.id)).toBeVisible()
    expect(card(blueTop.id)).toBeNull()
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
    ])
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P0] [7.6-NAT-005] the Retry on a failure after a Retry succeeded sends only the piece still failed, once, under the current bearer', async () => {
    const shoesReplies = [serverError, ok]
    const { changesBefore } = await landRetryInsideNewWindow(() =>
      shoesReplies.shift()!()
    )
    advance(windowMs)
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(deletes).toHaveLength(3)

    // The session refreshes; the top is already deleted, so this Retry belongs to the shoes.
    restoreToken()
    restoreToken = setMobileAccessTokenResolver(() => REFRESHED_TOKEN)
    const eventsBefore = events.length
    const announcedBefore = announced.length
    await browserUser.click(retryButton())

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    await waitFor(() => expect(events).toHaveLength(eventsBefore + 2))
    expect(events.slice(eventsBefore)).toEqual([
      committingEvent(plainShoes.id),
      committedEvent(plainShoes.id),
    ])
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
      sentDelete(plainShoes.id, REFRESHED_BEARER),
    ])
    // One Deleted, for the shoes; the top's was already said.
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    expect(card(plainShoes.id)).toBeNull()
    expect(card(blueTop.id)).toBeNull()
    expect(changes).toBe(changesBefore + 2)
  })

  it('[P0] [7.6-NAT-005] a Deleted held behind an Undo window is dropped when the account changes; nothing shows to the next account', async () => {
    const { announcedBefore } = await landRetryInsideNewWindow(ok)

    await switchAccount()

    // The shoes' Undo leaves the bar and their delete is sent at once, silently.
    expect(noBar()).toBeNull()
    expect(clock.active()).toBe(0)
    await waitFor(() => expect(events.at(-1)).toEqual(committedEvent(plainShoes.id)))
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
    ])
    advance(windowMs)
    expect(noBar()).toBeNull()
    expect(announced.slice(announcedBefore)).toEqual([])
  })

  it('[P0] [7.6-NAT-005] a Retry covered by a new Undo comes back once that window ends, and still retries only the failed piece', async () => {
    const replies: Record<string, () => Response> = {
      [blueTop.id]: serverError,
      [plainShoes.id]: ok,
    }
    deleteReply = (id) => replies[id]!()
    await renderLoadedHub()
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))

    // A new deferred delete covers the Retry with its Undo.
    requestDelete(plainShoes.id)
    expect(bar().textContent).toBe('DeletedUndo')

    advance(windowMs - 1)
    expect(bar().textContent).toBe('DeletedUndo')

    advance(1)

    // The window closed as the shoes' send started: the Retry is back on top.
    expect(bar().textContent).toBe(FAILED_WITH_RETRY)
    await waitFor(() => expect(events.at(-1)).toEqual(committedEvent(plainShoes.id)))
    expect(bar().textContent).toBe(FAILED_WITH_RETRY)
    expect(announced).toEqual([FAILED, 'Deleted', FAILED])
    replies[blueTop.id] = ok

    await browserUser.click(retryButton())

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
      sentDelete(blueTop.id),
    ])
    expect(card(blueTop.id)).toBeNull()
    expect(card(plainShoes.id)).toBeNull()
  })

  it('[P0] [7.6-NAT-005] a Deleted that lands while a Retry shows is only announced; the Retry stays on the bar for its piece', async () => {
    const replies: Record<string, () => Response> = {
      [blueTop.id]: serverError,
      [plainShoes.id]: ok,
    }
    deleteReply = (id) => replies[id]!()
    await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))

    // A confirmed delete of the shoes lands while the Retry shows.
    requestDelete(plainShoes.id, 'immediate')

    await waitFor(() => expect(announced).toEqual([FAILED, 'Deleted']))
    expect(bar().textContent).toBe(FAILED_WITH_RETRY)
    expect(card(plainShoes.id)).toBeNull()
    expect(card(blueTop.id)).toBeVisible()
    expect(changes).toBe(changesBefore + 1)
    replies[blueTop.id] = ok

    await browserUser.click(retryButton())

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
      sentDelete(blueTop.id),
    ])
    expect(announced).toEqual([FAILED, 'Deleted', 'Deleted'])
    expect(changes).toBe(changesBefore + 2)
  })

  it('[P0] [7.6-NAT-005] a Retry with no bearer while an Undo window is open waits for that window before it shows again', async () => {
    const bearerRead = heldBearerRead()
    const resolveAccessToken = vi.fn(() => bearerRead.read)
    deletion = createDeletion({ resolveAccessToken })
    const replies: Record<string, () => Response> = {
      [blueTop.id]: serverError,
      [plainShoes.id]: ok,
    }
    deleteReply = (id) => replies[id]!()
    await renderLoadedHub()
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    await browserUser.click(retryButton())
    expect(resolveAccessToken).toHaveBeenCalledTimes(1)
    requestDelete(plainShoes.id)
    expect(bar().textContent).toBe('DeletedUndo')

    // The session ended: the bearer read answers nothing while the shoes' window is open.
    await act(async () => {
      bearerRead.answer('')
      await bearerRead.read
    })

    expect(bar().textContent).toBe('DeletedUndo')
    expect(announced).toEqual([FAILED, 'Deleted'])
    expect(deletes).toEqual([sentDelete(blueTop.id)])

    advance(windowMs)

    expect(bar().textContent).toBe(FAILED_WITH_RETRY)
    expect(announced).toEqual([FAILED, 'Deleted', FAILED])
    await waitFor(() => expect(events.at(-1)).toEqual(committedEvent(plainShoes.id)))
    expect(bar().textContent).toBe(FAILED_WITH_RETRY)
    expect(deletes).toEqual([sentDelete(blueTop.id), sentDelete(plainShoes.id)])
    expect(card(blueTop.id)).toBeVisible()
  })

  /** The top's confirmed delete fails and its Retry shows; the closet also holds a scarf. */
  async function showTopRetry() {
    closet = [blueTop, plainShoes, greenScarf]
    const replies: Record<string, () => Response> = {
      [blueTop.id]: serverError,
      [plainShoes.id]: ok,
      [greenScarf.id]: ok,
    }
    deleteReply = (id) => replies[id]!()
    await renderLoadedHub()
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    return replies
  }

  /** After the Retry left the bar: a later window ends with no Retry coming back. */
  async function expectNoRetryAfterWindow() {
    const announcedBefore = announced.length
    requestDelete(greenScarf.id)
    expect(bar().textContent).toBe('DeletedUndo')

    advance(windowMs)

    await waitFor(() => expect(events.at(-1)).toEqual(committedEvent(greenScarf.id)))
    expect(bar().textContent).toBe('DeletedUndo')
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    expect(card(blueTop.id)).toBeVisible()
  }

  it('[P0] [7.6-NAT-005] a Retry the member dismissed is gone: the next Deleted shows on the bar and no Retry returns after a later window', async () => {
    await showTopRetry()

    act(() => otherFeature.bar!.dismissNotice())

    expect(noBar()).toBeNull()
    requestDelete(plainShoes.id, 'immediate')

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(announced).toEqual([FAILED, 'Deleted'])
    await expectNoRetryAfterWindow()
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
      sentDelete(greenScarf.id),
    ])
  })

  it('[P0] [7.6-NAT-005] a Retry another feature replaced is gone: the next Deleted shows on the bar and no Retry returns after a later window', async () => {
    await showTopRetry()

    act(() => {
      otherFeature.bar!.showNotice({
        id: 'other-feature-saved',
        message: 'Saved',
        durationMs: NEVER_ON_REAL_TIME_MS,
      })
    })

    expect(bar().textContent).toBe('Saved')
    requestDelete(plainShoes.id, 'immediate')

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(announced).toEqual([FAILED, 'Saved', 'Deleted'])
    await expectNoRetryAfterWindow()
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
      sentDelete(greenScarf.id),
    ])
  })

  it('[P0] [7.6-NAT-005] a Retry that expired uncovered is not merged into a later failure: the new Retry sends only the new piece', async () => {
    let now = 0
    deletion = createDeletion({ now: () => now })
    const replies = await showTopRetry()
    replies[plainShoes.id] = serverError

    // The top's Retry has run its course on the deletion's clock while the bar still shows it.
    now += windowMs
    requestDelete(plainShoes.id, 'immediate')

    await waitFor(() => expect(announced).toEqual([FAILED, FAILED]))
    expect(bar().textContent).toBe(FAILED_WITH_RETRY)
    replies[plainShoes.id] = ok

    await browserUser.click(retryButton())

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(plainShoes.id),
      sentDelete(plainShoes.id),
    ])
    expect(card(plainShoes.id)).toBeNull()
    expect(card(blueTop.id)).toBeVisible()
  })

  it('[P1] [7.6-NAT-006] a send that fails after the hub left still shows Could not delete with a working Retry', async () => {
    const answer = gate()
    const replies = [serverError, ok]
    deleteReply = async () => {
      await answer.opened
      return replies.shift()!()
    }
    const view = await renderLoadedHub()
    requestDelete(blueTop.id)

    // The closet tab leaves; the root status bar provider stays.
    view.rerender(hubTree(null))

    expect(screen.queryByTestId('wardrobe-screen')).toBeNull()
    expect(clock.active()).toBe(0)
    await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
    answer.open()
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      committingEvent(blueTop.id),
      failedEvent(blueTop.id),
      reportEvent(blueTop.id),
    ])

    await browserUser.click(retryButton())

    await waitFor(() => expect(events).toHaveLength(6))
    expect(events.slice(4)).toEqual([
      committingEvent(blueTop.id),
      committedEvent(blueTop.id),
    ])
    expect(deletes).toEqual([sentDelete(blueTop.id), sentDelete(blueTop.id)])
    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
  })

  it('[P0] [7.6-NAT-006] a Retry that succeeds after the hub unmounted tells other screens exactly once and shows Deleted', async () => {
    const replies = [serverError, ok]
    deleteReply = () => replies.shift()!()
    const view = await renderLoadedHub()
    requestDelete(blueTop.id)

    // The closet tab unmounts; the root status bar provider stays.
    view.rerender(hubTree(null))

    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(screen.queryByTestId('wardrobe-screen')).toBeNull()
    const changesBefore = changes
    const announcedBefore = announced.length

    await browserUser.click(retryButton())

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    expect(changes).toBe(changesBefore + 1)
    expect(deletes).toEqual([sentDelete(blueTop.id), sentDelete(blueTop.id)])
    expect(events.slice(4)).toEqual([
      committingEvent(blueTop.id),
      committedEvent(blueTop.id),
    ])
  })

  it('[P0] [7.6-NAT-006] Retry pressed while the member is on another tab sends once each time and its answer is still heard; back on the Closet the piece is gone', async () => {
    const replies = [serverError, serverError, ok]
    deleteReply = () => replies.shift()!()
    await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id)

    // A tab switch sends the delete at once, and it fails.
    setHubFocus(false)

    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    const announcedBefore = announced.length

    await browserUser.click(retryButton())

    // A second failure offers Retry again.
    await waitFor(() => expect(announced.slice(announcedBefore)).toEqual([FAILED]))
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(deletes).toEqual([sentDelete(blueTop.id), sentDelete(blueTop.id)])
    expect(changes).toBe(changesBefore)

    await browserUser.click(retryButton())

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(announced.slice(announcedBefore)).toEqual([FAILED, 'Deleted'])
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id),
      sentDelete(blueTop.id),
    ])
    expect(events.slice(4)).toEqual([
      committingEvent(blueTop.id),
      failedEvent(blueTop.id),
      reportEvent(blueTop.id),
      committingEvent(blueTop.id),
      committedEvent(blueTop.id),
    ])
    expect(changes).toBe(changesBefore + 1)

    setHubFocus(true)

    expect(card(blueTop.id)).toBeNull()
    expect(card(plainShoes.id)).toBeVisible()
    expect(clock.active()).toBe(0)
  })

  /**
   * Hub A sends its pending delete as it leaves, hub B mounts under the same provider and
   * account before the DELETE answers, and the answer is released.
   */
  async function remountWithHeldDelete(status: 204 | 500) {
    const answer = gate()
    const reply = { 204: ok, 500: serverError }[status]
    deleteReply = async () => {
      await answer.opened
      return reply()
    }
    const view = await renderLoadedHub()
    requestDelete(blueTop.id)
    view.rerender(hubTree(null))
    await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
    view.rerender(hubTree(deletion))
    await screen.findByTestId(`garment-card-${plainShoes.id}`)
    // Hub B hides the piece whose DELETE is still out.
    expect(card(blueTop.id)).toBeNull()
    const changesBefore = changes
    const announcedBefore = announced.length
    answer.open()
    return { changesBefore, announcedBefore }
  }

  it('[P0] [7.6-NAT-006] a DELETE that lands 204 after the hub remounted is applied once, by the new hub only', async () => {
    const { changesBefore, announcedBefore } = await remountWithHeldDelete(204)

    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(changes).toBe(changesBefore + 1)
    // A deferred commit announces nothing; the earlier Undo notice is not repeated either.
    expect(announced.slice(announcedBefore)).toEqual([])
    expect(card(blueTop.id)).toBeNull()
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P0] [7.6-NAT-006] a DELETE that fails after the hub remounted shows one Could not delete with Retry', async () => {
    const { changesBefore, announcedBefore } = await remountWithHeldDelete(500)

    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    expect(announced.slice(announcedBefore)).toEqual([FAILED])
    expect(card(blueTop.id)).toBeVisible()
    expect(changes).toBe(changesBefore)
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P1] [7.6-NAT-005] Retry with no bearer to send under sends nothing and offers Retry again', async () => {
    deleteReply = serverError
    await renderLoadedHub()
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    const eventsBefore = events.length
    const announcedBefore = announced.length

    // The session ended without a sign-out: the bearer read answers nothing.
    restoreToken()
    restoreToken = setMobileAccessTokenResolver(() => undefined)
    await browserUser.click(retryButton())

    await waitFor(() => expect(announced.slice(announcedBefore)).toEqual([FAILED]))
    expect(bar().textContent).toBe(FAILED_WITH_RETRY)
    expect(events).toHaveLength(eventsBefore)
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(card(blueTop.id)).toBeVisible()
  })

  it('[P0] [7.6-NAT-006] a DELETE that lands before the remounted hub read its closet reads the closet once more, without the piece', async () => {
    const answer = gate()
    deleteReply = async () => {
      await answer.opened
      return ok()
    }
    const view = await renderLoadedHub()
    requestDelete(blueTop.id)
    view.rerender(hubTree(null))
    await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
    // Hub B mounts and its first closet read is out, answering with the piece still there.
    const firstRead = gate()
    listHeld = firstRead.opened
    const readsBefore = listReads.length
    view.rerender(hubTree(deletion))
    await waitFor(() => expect(listReads).toHaveLength(readsBefore + 1))
    expect(screen.queryByTestId('wardrobe-garment-list')).toBeNull()
    const changesBefore = changes
    // The server answers later reads without the deleted piece.
    listHeld = Promise.resolve()
    closet = [plainShoes]

    answer.open()

    await waitFor(() => expect(events.at(-1)).toEqual(committedEvent(blueTop.id)))
    expect(changes).toBe(changesBefore + 1)
    await screen.findByTestId(`garment-card-${plainShoes.id}`)
    expect(card(blueTop.id)).toBeNull()
    expect(listReads).toHaveLength(readsBefore + 2)
    expect(listReads.slice(readsBefore)).toEqual([BEARER, BEARER])
    // The read that started before the commit was dropped for the fresh one; let its handler end.
    firstRead.open()
  })

  it('[P0] [7.6-NAT-005] an account change during the bearer read at Retry sends nothing', async () => {
    const bearerRead = heldBearerRead()
    const resolveAccessToken = vi.fn(() => bearerRead.read)
    deletion = createDeletion({ resolveAccessToken })
    deleteReply = serverError
    await renderLoadedHub()
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    await browserUser.click(retryButton())
    expect(resolveAccessToken).toHaveBeenCalledTimes(1)
    const eventsBefore = events.length
    const announcedBefore = announced.length

    await switchAccount()
    deleteReply = ok
    await act(async () => {
      bearerRead.answer(REFRESHED_TOKEN)
      await bearerRead.read
    })

    expect(events).toHaveLength(eventsBefore)
    expect(deletion.pendingIds()).toEqual([])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(noBar()).toBeNull()
    expect(announced.slice(announcedBefore)).toEqual([])
  })

  it('[P0] [7.6-NAT-004] an account change takes the Undo notice off the bar; its stale Undo then sends and shows nothing', async () => {
    const recorded = recordingNotices(deletion)
    await renderLoadedHub(recorded.deletion)
    const changesBefore = changes
    requestDelete(blueTop.id)
    expect(bar().textContent).toBe('DeletedUndo')
    const undoNotice = recorded.notices.at(-1)!
    expect(undoNotice.actions!.map((action) => action.label)).toEqual(['Undo'])

    await switchAccount()

    // The notice leaves the bar and the last account's delete is sent at once, silently.
    expect(noBar()).toBeNull()
    expect(clock.active()).toBe(0)
    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    )
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    const announcedBefore = announced.length

    act(() => {
      void undoNotice.actions![0]!.onPress()
    })

    expect(events).toHaveLength(3)
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(noBar()).toBeNull()
    expect(announced.slice(announcedBefore)).toEqual([])
    expect(recorded.notices).toHaveLength(1)
    expect(changes).toBe(changesBefore)
  })

  it('[P0] [7.6-NAT-004] an account change takes the Retry notice off the bar; its stale Retry then reads no bearer, sends nothing and shows nothing', async () => {
    const resolveAccessToken = vi.fn(() => resolveMobileAccessToken())
    deletion = createDeletion({ resolveAccessToken })
    const recorded = recordingNotices(deletion)
    deleteReply = serverError
    await renderLoadedHub(recorded.deletion)
    requestDelete(blueTop.id, 'immediate')
    await waitFor(() => expect(bar().textContent).toBe(FAILED_WITH_RETRY))
    const retryNotice = recorded.notices.at(-1)!
    expect(retryNotice.actions!.map((action) => action.label)).toEqual(['Retry'])

    await switchAccount()

    expect(noBar()).toBeNull()
    const announcedBefore = announced.length
    deleteReply = ok

    await act(async () => {
      await retryNotice.actions![0]!.onPress()
    })

    expect(resolveAccessToken).not.toHaveBeenCalled()
    expect(events).toEqual([
      committingEvent(blueTop.id),
      failedEvent(blueTop.id),
      reportEvent(blueTop.id),
    ])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(noBar()).toBeNull()
    expect(announced.slice(announcedBefore)).toEqual([])
    expect(recorded.notices).toHaveLength(1)
  })

  it('[P1] [7.6-NAT-007] the hub stays mounted at its scroll offset and tells other screens once the delete commits', async () => {
    const piece = photo('#556b2f')
    const pieces = Array.from({ length: 12 }, (_, index) => ({
      ...createReadyGarmentFixture({
        id: `delete-piece-${index + 1}`,
        imageAccess: piece,
      }),
      colorFamily: null,
    }))
    closet = pieces
    renderHub()
    await screen.findByTestId('garment-card-delete-piece-12')
    // The cards mount under the Closet gate before it opens (Story 7.7), and a hidden list
    // drops a scroll offset, so the offset is set once the gate shows the list.
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    )
    const grid = screen.getByTestId('wardrobe-garment-list')
    const scroller = scrollContainerOf(grid)
    act(() => {
      scroller.scrollTop = 400
    })
    await waitFor(() => expect(scroller.scrollTop).toBe(400))
    const changesBefore = changes

    // The last card: removing it leaves its row, so the content above the offset is unchanged.
    requestDelete('delete-piece-12')

    expect(card('delete-piece-12')).toBeNull()
    expect(screen.getByTestId('wardrobe-garment-list')).toBe(grid)
    expect(scrollContainerOf(grid)).toBe(scroller)
    expect(scroller.scrollTop).toBe(400)
    expect(changes).toBe(changesBefore)

    advance(windowMs)

    await waitFor(() =>
      expect(events).toEqual([
        scheduledEvent('delete-piece-12'),
        committingEvent('delete-piece-12'),
        committedEvent('delete-piece-12'),
      ])
    )
    expect(changes).toBe(changesBefore + 1)
    expect(deletes).toEqual([sentDelete('delete-piece-12')])
    expect(screen.getByTestId('wardrobe-garment-list')).toBe(grid)
    expect(screen.getAllByTestId(/^garment-card-delete-piece-/)).toHaveLength(11)
    // The commit removed nothing above the offset, and nothing reset the scroll.
    expect(scrollContainerOf(grid)).toBe(scroller)
    expect(scroller.scrollTop).toBe(400)
  })

  // Capsules is pushed over the hub, so the hub's delete feedback keeps running under it; a
  // delete that lands while Capsules is open has to reach Capsules through the wardrobe change.
  describe('Capsules open over the hub', () => {
    const capsuleGarment = (id: string, category: string, garmentOrder: number) => ({
      id,
      category,
      material: 'cotton',
      comfortRange: 'mild',
      imageAccess: null,
      availabilityStatus: 'ready',
      garmentOrder,
    })
    const readyCapsule = {
      id: 'delete-work-capsule',
      ownerUserId: owner,
      name: 'Work capsule',
      description: null,
      occasions: ['work'],
      isFavorite: false,
      revision: 1,
      availabilityStatus: 'ready',
      unavailableGarmentCount: 0,
      garments: [
        capsuleGarment(blueTop.id, 'top', 0),
        capsuleGarment(plainShoes.id, 'shoes', 1),
      ],
      createdAt: '2026-08-05T10:00:00.000Z',
      updatedAt: '2026-08-05T10:00:00.000Z',
    }
    /** The same capsule once the server dropped the deleted top from it. */
    const repairCapsule = {
      ...readyCapsule,
      revision: 2,
      availabilityStatus: 'needs_repair',
      unavailableGarmentCount: 1,
      garments: [
        { ...capsuleGarment(blueTop.id, 'top', 0), availabilityStatus: 'needs_repair' },
        capsuleGarment(plainShoes.id, 'shoes', 1),
      ],
    }
    const profileOwners = new Map<string | null, string>([
      [BEARER, owner],
      [SECOND_BEARER, secondMember],
    ])
    let capsuleReply: Record<string, unknown>
    let capsuleReads: { path: string; authorization: string | null }[]
    const capsuleRead = (member: string, authorization = BEARER) => ({
      path: `/api/v1/wardrobe/${member}/capsules`,
      authorization,
    })

    beforeEach(() => {
      capsuleReply = readyCapsule
      capsuleReads = []
      server.use(
        http.get('*/api/v1/user/profile', ({ request }) => {
          const member = profileOwners.get(request.headers.get('authorization'))
          if (!member)
            return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
          return HttpResponse.json({
            user: {
              id: member,
              email: `${member}@synthetic.test`,
              displayName: null,
              birthdate: '1990-01-01T00:00:00.000Z',
              role: 'guardian',
            },
            linkedGuardians: [],
            linkedTeens: [],
          })
        }),
        http.get('*/api/v1/wardrobe/:ownerUserId/capsules', ({ request }) => {
          capsuleReads.push({
            path: new URL(request.url).pathname,
            authorization: request.headers.get('authorization'),
          })
          return HttpResponse.json({
            data: [capsuleReply],
            total: 1,
            limit: 20,
            offset: 0,
          })
        })
      )
    })

    it('[P1] [7.6-NAT-007] a delete that lands while Capsules is open reads the capsules again, so the capsule stops showing Ready', async () => {
      const answer = gate()
      deleteReply = async () => {
        await answer.opened
        return ok()
      }
      const view = await renderLoadedHub()
      requestDelete(blueTop.id)

      // Story CC-7.11 D8: Capsules opens from the Looks tab (its row, 7.11-NAT-014), so the
      // member leaves the Closet first: the hub blurs on that tab press and sends the delete,
      // held at the server. The Closet offers no Capsules entry of its own any more.
      expect(screen.queryByTestId('wardrobe-capsules-link')).toBeNull()
      setHubFocus(false)
      await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
      view.rerender(hubTree(deletion, true))
      expect(await screen.findByText('2 garments · Ready')).toBeInTheDocument()
      expect(capsuleReads).toEqual([capsuleRead(owner)])
      const changesBefore = changes
      capsuleReply = repairCapsule

      answer.open()

      await waitFor(() => expect(capsuleReads).toHaveLength(2))
      expect(capsuleReads).toEqual([capsuleRead(owner), capsuleRead(owner)])
      expect(await screen.findByText('2 garments · Needs repair')).toBeInTheDocument()
      expect(screen.queryByText('2 garments · Ready')).toBeNull()
      expect(changes).toBe(changesBefore + 1)
      expect(events).toEqual([
        scheduledEvent(blueTop.id),
        committingEvent(blueTop.id),
        committedEvent(blueTop.id),
      ])
    })

    it('[P1] [7.6-NAT-007] a wardrobe change heard after the account changed reads no capsules for the last account', async () => {
      render(hubTree(null, true))
      expect(await screen.findByText('2 garments · Ready')).toBeInTheDocument()
      expect(capsuleReads).toEqual([capsuleRead(owner)])

      act(() => {
        restoreToken()
        restoreToken = setMobileAccessTokenResolver(() => SECOND_TOKEN)
        setMobileApplicationUserId(secondMember)
        // The change arrives before Capsules renders for the new account.
        notifyWardrobeChanged()
      })

      // Only the new account's first read follows; the last account's capsules are not read.
      await waitFor(() => expect(capsuleReads).toHaveLength(2))
      expect(capsuleReads).toEqual([
        capsuleRead(owner),
        capsuleRead(secondMember, SECOND_BEARER),
      ])
      expect(await screen.findByText('2 garments · Ready')).toBeInTheDocument()
      expect(capsuleReads).toHaveLength(2)
    })
  })
})
