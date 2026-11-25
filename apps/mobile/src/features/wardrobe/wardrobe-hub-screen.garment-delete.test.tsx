// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
// Story 7.6 test plan 7.6-NAT-004..007 (and the hub side of 7.6-NAT-002..003): the hub stays
// mounted under the pushed detail and owns the delete feedback. A pending piece is hidden;
// "Deleted" with Undo shows for a deferred delete; Undo inside the window sends nothing; the
// window end, a background, a second delete or leaving the hub sends the DELETE; a failed
// send returns the piece with Retry under the hub's live bearer; an event from another account
// is ignored. Every case drives a fresh controller on a manual timer.
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
}))
vi.mock('expo-router', () => ({ router: routerMock }))

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
} from '@couture/utils'
import { reportNetworkOnline, SaveFeedbackProvider } from '@/components/save-feedback'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  mobileIdentityEpoch,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { notifyWardrobeChanged, onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { server } from '@/src/test-utils/msw/server'
import {
  createMobileGarmentDeletion,
  resetGarmentDeletionForTests,
  type GarmentDeleteMode,
  type GarmentDeletionEvent,
  type MobileGarmentDeletion,
} from './garment-deletion'
import { WardrobeHubScreen } from './wardrobe-hub-screen'

const owner = 'hub-delete-owner'
const windowMs = SAVE_FEEDBACK_TIMINGS.statusBarDurationMs

function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken(owner)
const BEARER = `Bearer ${ACCESS_TOKEN}`
/** The same member's bearer after a session refresh. */
const REFRESHED_TOKEN = `${ACCESS_TOKEN}-refreshed`

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

const onboardingNotCompleted = {
  status: 'in_progress' as const,
  currentStep: 'capture' as const,
  usedStarterWardrobe: false,
  garmentsCapturedCount: 0,
  startedAt: '2026-08-09T00:00:00.000Z',
  completedAt: null,
  revision: 1,
}

/** A manual timer for the deletion controller: `advance` runs every callback due by then. */
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
  const advance = (ms: number) => {
    now += ms
    for (const [handle, entry] of [...scheduled.entries()].sort(
      (a, b) => a[1].at - b[1].at
    )) {
      if (entry.at > now) continue
      scheduled.delete(handle)
      entry.callback()
    }
  }
  return { timer, advance, active: () => scheduled.size }
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
const sentDelete = (id: string, authorization = BEARER) => ({ id, authorization })
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)

/** A gate a handler awaits, so a test decides when the answer lands. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

/**
 * Wraps a deletion so a test can deliver an event the hub hears as if the deletion sent it,
 * for example one stamped with another account's identity epoch.
 */
function withInjectableEvents(real: MobileGarmentDeletion) {
  const listeners = new Set<(event: GarmentDeletionEvent) => void>()
  const deletion: MobileGarmentDeletion = {
    ...real,
    subscribe(listener) {
      listeners.add(listener)
      const stop = real.subscribe(listener)
      return () => {
        listeners.delete(listener)
        stop()
      }
    },
  }
  const deliver = (event: GarmentDeletionEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  return { deletion, deliver, listening: () => listeners.size }
}
const scheduledEvent = (id: string) => ({ type: 'scheduled', id }) as const
const committingEvent = (id: string) => ({ type: 'committing', id }) as const
const committedEvent = (id: string) => ({ type: 'committed', id }) as const

describe('WardrobeHubScreen garment delete (Story 7.6)', () => {
  let closet: Record<string, unknown>[]
  let deletes: { id: string; authorization: string | null }[]
  let listReads: (string | null)[]
  let deleteReply: () => Response | Promise<Response>
  let changes: number
  let stopWatching: () => void
  let restoreToken: () => void
  let clock: ReturnType<typeof createManualTimer>
  let deletion: MobileGarmentDeletion
  let events: DeferredGarmentDeletionEvent[]
  /** Every notice the root status bar announced, in order (one entry per notice shown). */
  let announced: string[]
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  /**
   * The root status bar provider around a phone-height frame, so the hub's ScrollView scrolls
   * like the real screen. Without the hub the provider stays mounted, as the root one does when
   * the closet tab leaves.
   */
  function hubTree(hub: MobileGarmentDeletion | null) {
    return (
      <SaveFeedbackProvider onAnnounce={(entry) => announced.push(entry.message)}>
        <View style={{ height: 600 }}>
          {hub ? <WardrobeHubScreen pollOffsetsMs={[1, 1, 1, 1]} deletion={hub} /> : null}
        </View>
      </SaveFeedbackProvider>
    )
  }

  function renderHub(hub: MobileGarmentDeletion = deletion) {
    return render(hubTree(hub))
  }

  /** What the detail does after Delete: it requests the delete, then pops to the hub. */
  function requestDelete(id: string, mode: GarmentDeleteMode = 'deferred') {
    act(() => deletion.request(id, mode, ACCESS_TOKEN))
  }

  function advance(ms: number) {
    act(() => clock.advance(ms))
  }

  function changeAppState(state: ReactNativeModule.AppStateStatus) {
    act(() => {
      appState.state = state
      for (const listener of [...appState.listeners]) listener(state)
    })
  }

  async function renderLoadedHub(hub: MobileGarmentDeletion = deletion) {
    const view = renderHub(hub)
    await screen.findByTestId(`garment-card-${blueTop.id}`)
    expect(card(plainShoes.id)).toBeVisible()
    return view
  }

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreToken = setMobileAccessTokenResolver(() => ACCESS_TOKEN)
    setMobileApplicationUserId(owner)
    reportNetworkOnline()
    closet = [blueTop, plainShoes]
    deletes = []
    listReads = []
    deleteReply = () => new HttpResponse(null, { status: 204 })
    changes = 0
    stopWatching = onWardrobeChanged(() => {
      changes++
    })
    appState.state = 'active'
    clock = createManualTimer()
    deletion = createMobileGarmentDeletion(
      createDeferredGarmentDeletion({ timer: clock.timer })
    )
    events = []
    announced = []
    deletion.controller.subscribe((event) => {
      events.push(event)
    })
    server.use(
      http.get('*/api/v1/wardrobe/garments', ({ request }) => {
        listReads.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: closet })
      }),
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: onboardingNotCompleted })
      ),
      http.delete('*/api/v1/wardrobe/garments/:garmentId', ({ request, params }) => {
        deletes.push({
          id: String(params.garmentId),
          authorization: request.headers.get('authorization'),
        })
        return deleteReply()
      })
    )
  })

  afterEach(() => {
    // Drop pending deletes before the hub unmounts, so its unmount flush sends nothing.
    deletion.reset()
    resetGarmentDeletionForTests()
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
    await browserUser.click(within(bar()).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(bar().textContent).toBe('Undone'))
    expect(card(blueTop.id)).toBeVisible()
    advance(windowMs)
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      { type: 'undone', id: blueTop.id },
    ])
    expect(clock.active()).toBe(0)
    expect(deletes).toEqual([])
    expect(changes).toBe(changesBefore)
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

  it('[P0] [7.6-NAT-005] a failed send returns the piece with Retry; Retry sends once at once under the live bearer and shows Deleted', async () => {
    deleteReply = () =>
      HttpResponse.json(
        { statusCode: 500, message: 'Internal server error' },
        { status: 500 }
      )
    await renderLoadedHub()
    const changesBefore = changes
    requestDelete(blueTop.id)

    advance(windowMs)

    await waitFor(() =>
      expect(bar().textContent).toBe('Could not delete this piece.Retry')
    )
    expect(card(blueTop.id)).toBeVisible()
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      committingEvent(blueTop.id),
      { type: 'failed', id: blueTop.id, error: expect.any(Error) },
    ])
    expect(changes).toBe(changesBefore)

    // The session refreshes; the hub's next closet read carries the new bearer.
    restoreToken()
    restoreToken = setMobileAccessTokenResolver(() => REFRESHED_TOKEN)
    act(() => notifyWardrobeChanged())
    await waitFor(() => expect(listReads.at(-1)).toBe(`Bearer ${REFRESHED_TOKEN}`))
    const changesBeforeRetry = changes
    deleteReply = () => new HttpResponse(null, { status: 204 })
    await browserUser.click(within(bar()).getByRole('button', { name: 'Retry' }))

    // Retry opens no new Undo window and sends under the live bearer, not the failed one.
    expect(clock.active()).toBe(0)
    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(deletes).toEqual([
      sentDelete(blueTop.id),
      sentDelete(blueTop.id, `Bearer ${REFRESHED_TOKEN}`),
    ])
    expect(card(blueTop.id)).toBeNull()
    expect(events.slice(3)).toEqual([
      committingEvent(blueTop.id),
      committedEvent(blueTop.id),
    ])
    expect(changes).toBe(changesBeforeRetry + 1)
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

    await browserUser.click(within(bar()).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(card(plainShoes.id)).toBeVisible())
    expect(card(blueTop.id)).toBeNull()
    advance(windowMs)
    expect(events.slice(4)).toEqual([{ type: 'undone', id: plainShoes.id }])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P1] [7.6-NAT-006] leaving the hub inside the window sends the DELETE at once', async () => {
    const view = await renderLoadedHub()
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
      return new HttpResponse(null, { status: 204 })
    }
    await renderLoadedHub()
    const changesBefore = changes

    requestDelete(blueTop.id, 'gone')

    expect(card(blueTop.id)).toBeNull()
    expect(clock.active()).toBe(0)
    expect(events).toEqual([committingEvent(blueTop.id)])
    await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
    // Nothing is announced before the DELETE answers.
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

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
    expect([...events.slice(3)].sort(byId)).toEqual([
      committedEvent(blueTop.id),
      committedEvent(plainShoes.id),
    ])
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
      return HttpResponse.json(
        { statusCode: 500, message: 'Internal server error' },
        { status: 500 }
      )
    }
    await renderLoadedHub()
    await sendHeldDelete()
    const announcedBefore = announced.length

    await browserUser.click(within(bar()).getByRole('button', { name: 'Undo' }))

    // The tap closes the Undo notice and nothing replaces it until the answer lands.
    await waitFor(() => expect(screen.queryByTestId('status-feedback-bar')).toBeNull())
    expect(announced.slice(announcedBefore)).toEqual([])
    expect(card(blueTop.id)).toBeNull()

    answer.open()

    await waitFor(() =>
      expect(bar().textContent).toBe('Could not delete this piece.Retry')
    )
    expect(announced.slice(announcedBefore)).toEqual(['Could not delete this piece.'])
    expect(card(blueTop.id)).toBeVisible()
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      committingEvent(blueTop.id),
      { type: 'failed', id: blueTop.id, error: expect.any(Error) },
    ])
    expect(deletes).toEqual([sentDelete(blueTop.id)])
  })

  it('[P0] [7.6-NAT-004] Undo tapped while the DELETE is out shows nothing new; a 204 answer then says Deleted once', async () => {
    const answer = gate()
    deleteReply = async () => {
      await answer.opened
      return new HttpResponse(null, { status: 204 })
    }
    await renderLoadedHub()
    const changesBefore = changes
    await sendHeldDelete()
    const announcedBefore = announced.length

    await browserUser.click(within(bar()).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.queryByTestId('status-feedback-bar')).toBeNull())
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

    await browserUser.click(within(bar()).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(within(bar()).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(announced.slice(announcedBefore)).toEqual(['Deleted'])
    expect(card(blueTop.id)).toBeNull()
    expect(deletes).toEqual([sentDelete(blueTop.id)])
    expect(changes).toBe(changesBefore + 1)
  })

  it('[P0] [7.6-NAT-005] events stamped with another account epoch neither change the grid nor show a notice', async () => {
    const injectable = withInjectableEvents(deletion)
    await renderLoadedHub(injectable.deletion)
    // The hub listens through the wrapper, so a delivered event reaches it.
    expect(injectable.listening()).toBe(1)
    const changesBefore = changes
    const foreign = mobileIdentityEpoch() + 1

    act(() => {
      injectable.deliver({ type: 'scheduled', id: blueTop.id, epoch: foreign })
      injectable.deliver({
        type: 'failed',
        id: blueTop.id,
        error: new Error('Internal server error'),
        epoch: foreign,
      })
      injectable.deliver({ type: 'undone', id: blueTop.id, epoch: foreign })
      injectable.deliver({
        type: 'committed',
        id: blueTop.id,
        announce: true,
        epoch: foreign,
      })
    })

    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    expect(announced).toEqual([])
    expect(card(blueTop.id)).toBeVisible()
    expect(card(plainShoes.id)).toBeVisible()
    expect(changes).toBe(changesBefore)
    expect(deletes).toEqual([])

    // The same piece requested under this account records its epoch and does reach the hub.
    requestDelete(blueTop.id, 'immediate')

    await waitFor(() => expect(bar().textContent).toBe('Deleted'))
    expect(announced).toEqual(['Deleted'])
    expect(card(blueTop.id)).toBeNull()
    expect(deletes).toEqual([sentDelete(blueTop.id)])
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
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

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
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    expect(announced).toEqual([])
    expect(changes).toBe(changesBefore)
    expect(deletes).toEqual([])
  })

  it('[P1] [7.6-NAT-006] a send that fails after the hub left still shows Could not delete with a working Retry', async () => {
    const answer = gate()
    let failNext = true
    deleteReply = async () => {
      await answer.opened
      return failNext
        ? HttpResponse.json(
            { statusCode: 500, message: 'Internal server error' },
            { status: 500 }
          )
        : new HttpResponse(null, { status: 204 })
    }
    const view = await renderLoadedHub()
    requestDelete(blueTop.id)

    // The closet tab leaves; the root status bar provider stays.
    view.rerender(hubTree(null))

    expect(screen.queryByTestId('wardrobe-screen')).toBeNull()
    expect(clock.active()).toBe(0)
    await waitFor(() => expect(deletes).toEqual([sentDelete(blueTop.id)]))
    answer.open()
    await waitFor(() =>
      expect(bar().textContent).toBe('Could not delete this piece.Retry')
    )
    expect(events).toEqual([
      scheduledEvent(blueTop.id),
      committingEvent(blueTop.id),
      { type: 'failed', id: blueTop.id, error: expect.any(Error) },
    ])

    failNext = false
    await browserUser.click(within(bar()).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(events).toHaveLength(5))
    expect(events.slice(3)).toEqual([
      committingEvent(blueTop.id),
      committedEvent(blueTop.id),
    ])
    expect(deletes).toEqual([sentDelete(blueTop.id), sentDelete(blueTop.id)])
  })

  /**
   * Hub A sends its pending delete as it leaves, hub B mounts under the same provider and
   * account before the DELETE answers, and the answer is released.
   */
  async function remountWithHeldDelete(status: 204 | 500) {
    const answer = gate()
    deleteReply = async () => {
      await answer.opened
      return status === 204
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json(
            { statusCode: 500, message: 'Internal server error' },
            { status: 500 }
          )
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

    await waitFor(() =>
      expect(bar().textContent).toBe('Could not delete this piece.Retry')
    )
    expect(announced.slice(announcedBefore)).toEqual(['Could not delete this piece.'])
    expect(card(blueTop.id)).toBeVisible()
    expect(changes).toBe(changesBefore)
    expect(deletes).toEqual([sentDelete(blueTop.id)])
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
  })
})
