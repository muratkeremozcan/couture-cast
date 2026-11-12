// Learning path Step 23: Home and lock-screen widgets.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-23-home-and-lock-screen-widgets
// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '../test-utils/msw/server'
import { mockRitualResponse } from '../test-utils/msw/handlers'
import { isWidgetCacheFresh } from './widget-cache-freshness'

/**
 * `expo-task-manager` and `expo-background-task` are native boundaries with no
 * browser implementation, so they are stubbed here. Everything downstream of the
 * task body (settings, cache, HTTP, widget payload) runs for real against MSW
 * and localStorage, which is what makes the idempotency claims meaningful.
 */
const native = vi.hoisted(() => {
  const tasks = new Map<string, () => Promise<unknown>>()
  return {
    tasks,
    result: { Success: 1, Failed: 2 },
    defineTask: vi.fn((name: string, task: () => Promise<unknown>) => {
      tasks.set(name, task)
    }),
    isTaskRegisteredAsync: vi.fn(),
    unregisterTaskAsync: vi.fn(),
    registerTaskAsync: vi.fn(),
  }
})

vi.mock('expo-task-manager', () => ({
  defineTask: native.defineTask,
  isTaskRegisteredAsync: native.isTaskRegisteredAsync,
  unregisterTaskAsync: native.unregisterTaskAsync,
}))

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: native.result,
  registerTaskAsync: native.registerTaskAsync,
}))

import { registerRitualBackgroundTaskAsync } from './background-task'
import { setMobileAccessTokenResolver, setMobileApplicationUserId } from './mobile-auth'
import { clearRitualMemoryCache, ritualCacheOwner, saveRitualCache } from './ritual-cache'

const TASK_NAME = 'RITUAL_BACKGROUND_TASK'
/** The name SDK 54 builds registered through expo-background-fetch. */
const RETIRED_TASK_NAME = 'RITUAL_BACKGROUND_FETCH_TASK'
const MEMBER_ID = 'bg-user'
const USER_ID = ritualCacheOwner(MEMBER_ID)

function runRitualTask() {
  const task = native.tasks.get(TASK_NAME)
  if (!task) {
    throw new Error(`${TASK_NAME} was never registered with TaskManager`)
  }
  return task()
}

function signedOutKeys() {
  return Object.keys(localStorage).filter((key) => key.startsWith('ritual:signed-out:'))
}

function storedRitualEntry() {
  const raw = localStorage.getItem(
    `ritual:${USER_ID}:en-US:${mockRitualResponse.data.weather.locationKey}`
  )
  return raw
    ? (JSON.parse(raw) as { timestamp: number; alertPreferences?: unknown })
    : null
}

function publishedWidgetPayload() {
  const raw = localStorage.getItem('OutfitWidgetData')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

async function seedCache(timestamp: number) {
  await saveRitualCache(USER_ID, 'en-US', { data: mockRitualResponse, timestamp })
  clearRitualMemoryCache()
  localStorage.removeItem('OutfitWidgetData')
}

describe('widget background cache freshness', () => {
  const now = Date.parse('2026-07-24T18:00:00.000Z')

  it('accepts a cache entry inside the freshness window', () => {
    expect(isWidgetCacheFresh(now - 29 * 60 * 1000, now)).toBe(true)
  })

  it('expires a cache entry at the boundary', () => {
    expect(isWidgetCacheFresh(now - 30 * 60 * 1000, now)).toBe(false)
  })

  it('expires future and non-finite timestamps', () => {
    expect(isWidgetCacheFresh(now + 1, now)).toBe(false)
    expect(isWidgetCacheFresh(Number.NaN, now)).toBe(false)
  })
})

describe('ritual background task', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    localStorage.clear()
    clearRitualMemoryCache()
    setMobileApplicationUserId(MEMBER_ID)
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'member-token')
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    restoreAccessTokenResolver?.()
    setMobileApplicationUserId(null)
    localStorage.clear()
    clearRitualMemoryCache()
  })

  it('registers the ritual task with TaskManager at module load', () => {
    expect(native.tasks.has(TASK_NAME)).toBe(true)
  })

  /**
   * The idempotency guarantee: iOS wakes this task on its own schedule, and a
   * wake that lands inside the freshness window must not spend a request or
   * rewrite a cache entry that is already current.
   */
  it('does no work and reports Success when the cached ritual is still fresh', async () => {
    const ritualRequests = vi.fn()
    server.use(
      http.get('*/api/v1/ritual', () => {
        ritualRequests()
        return HttpResponse.json(mockRitualResponse)
      })
    )
    await seedCache(Date.now() - 60_000)

    await expect(runRitualTask()).resolves.toBe(native.result.Success)

    expect(ritualRequests).not.toHaveBeenCalled()
    expect(publishedWidgetPayload()).toBeNull()
  })

  it('refreshes an expired cache and republishes the widget payload', async () => {
    await seedCache(Date.now() - 31 * 60 * 1000)

    await expect(runRitualTask()).resolves.toBe(native.result.Success)

    const entry = storedRitualEntry()
    expect(entry?.timestamp).toBeGreaterThan(Date.now() - 60_000)
    expect(publishedWidgetPayload()).toMatchObject({ locale: 'en-US' })
  })

  it('populates an empty cache on the first wake', async () => {
    await expect(runRitualTask()).resolves.toBe(native.result.Success)

    expect(storedRitualEntry()).not.toBeNull()
    expect(publishedWidgetPayload()).not.toBeNull()
  })

  /** The saved locale, not the device locale, decides what the widget shows. */
  it('fetches in the locale the user saved in settings', async () => {
    localStorage.setItem(
      'couture-cast-settings.json',
      JSON.stringify({ locale: 'tr-TR', localeSyncPending: false })
    )
    let requestedLocale: string | null = null
    server.use(
      http.get('*/api/v1/ritual', ({ request }) => {
        requestedLocale = new URL(request.url).searchParams.get('locale')
        return HttpResponse.json(mockRitualResponse)
      })
    )

    await expect(runRitualTask()).resolves.toBe(native.result.Success)

    expect(requestedLocale).toBe('tr-TR')
    expect(publishedWidgetPayload()).toMatchObject({ locale: 'tr-TR' })
  })

  /**
   * R9-1: a cold background wake has no verified member until the token resolver restores
   * the session. The member is known only after that, so the ritual fetched with their
   * bearer must land under their key and never in the shared signed-out bucket, which a
   * signed-out Home or another member's first load would read.
   */
  it('stores a ritual fetched after a delayed verification under the member, never signed-out', async () => {
    setMobileApplicationUserId(null)
    setMobileAccessTokenResolver(() => {
      setMobileApplicationUserId(MEMBER_ID)
      return 'member-token'
    })

    await expect(runRitualTask()).resolves.toBe(native.result.Success)

    expect(storedRitualEntry()).not.toBeNull()
    expect(signedOutKeys()).toEqual([])
  })

  it('fetches and stores nothing when no member session verifies', async () => {
    const ritualRequests = vi.fn()
    server.use(
      http.get('*/api/v1/ritual', () => {
        ritualRequests()
        return HttpResponse.json(mockRitualResponse)
      })
    )
    setMobileApplicationUserId(null)
    setMobileAccessTokenResolver(() => undefined)

    await expect(runRitualTask()).resolves.toBe(native.result.Success)

    expect(ritualRequests).not.toHaveBeenCalled()
    expect(Object.keys(localStorage).filter((key) => key.startsWith('ritual:'))).toEqual(
      []
    )
  })

  /**
   * Alert preferences are a secondary dependency. When they are unavailable the
   * refresh must still complete and the widget must fail closed on alerts rather
   * than the whole background refresh reporting failure.
   */
  it('completes the refresh when the alert-preferences dependency is degraded', async () => {
    server.use(http.get('*/api/v1/alerts/preferences', () => HttpResponse.error()))

    await expect(runRitualTask()).resolves.toBe(native.result.Success)

    expect(storedRitualEntry()?.alertPreferences).toBeUndefined()
    expect(publishedWidgetPayload()).toMatchObject({ alertsEnabled: false })
  })

  /**
   * A failed refresh must report Failed and leave the last known good cache in
   * place; overwriting or clearing it would blank the widget on a transient 500.
   */
  it('reports Failed and preserves the previous cache when the ritual request fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const staleTimestamp = Date.now() - 45 * 60 * 1000
    await seedCache(staleTimestamp)
    server.use(http.get('*/api/v1/ritual', () => new HttpResponse(null, { status: 503 })))

    await expect(runRitualTask()).resolves.toBe(native.result.Failed)

    expect(storedRitualEntry()?.timestamp).toBe(staleTimestamp)
    expect(publishedWidgetPayload()).toBeNull()
    expect(consoleError).toHaveBeenCalled()
  })

  /** A response that does not match the contract must not reach the widget. */
  it('reports Failed when the ritual response violates the contract', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    server.use(
      http.get('*/api/v1/ritual', () => HttpResponse.json({ data: { outfits: [] } }))
    )

    await expect(runRitualTask()).resolves.toBe(native.result.Failed)

    expect(publishedWidgetPayload()).toBeNull()
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('registerRitualBackgroundTaskAsync', () => {
  beforeEach(() => {
    native.isTaskRegisteredAsync.mockReset()
    native.unregisterTaskAsync.mockReset()
    native.registerTaskAsync.mockReset()
  })

  function registered(...names: string[]) {
    native.isTaskRegisteredAsync.mockImplementation((name: string) =>
      Promise.resolve(names.includes(name))
    )
  }

  it('registers the task on a device that has never registered it', async () => {
    registered()

    await registerRitualBackgroundTaskAsync()

    expect(native.registerTaskAsync).toHaveBeenCalledWith(TASK_NAME, {
      minimumInterval: 15,
    })
    expect(native.unregisterTaskAsync).not.toHaveBeenCalled()
  })

  /** Re-registering on every launch would reset the OS scheduling budget. */
  it('skips registration when the task is already registered', async () => {
    registered(TASK_NAME)

    await registerRitualBackgroundTaskAsync()

    expect(native.registerTaskAsync).not.toHaveBeenCalled()
  })

  /**
   * An install upgraded from an SDK 54 build still has the background fetch task persisted by
   * expo-task-manager. It is unregistered before the new task registers, so the device keeps
   * exactly one ritual task and no consumer of the removed module.
   */
  it('retires the background fetch task of an upgraded install, then registers the new task', async () => {
    registered(RETIRED_TASK_NAME)
    const order: string[] = []
    native.unregisterTaskAsync.mockImplementation((name: string) => {
      order.push(`unregister:${name}`)
      return Promise.resolve()
    })
    native.registerTaskAsync.mockImplementation((name: string) => {
      order.push(`register:${name}`)
      return Promise.resolve()
    })

    await registerRitualBackgroundTaskAsync()

    expect(order).toEqual([`unregister:${RETIRED_TASK_NAME}`, `register:${TASK_NAME}`])
  })

  /** A missing consumer for the retired task must not cost the member the new task. */
  it('still registers the new task when retiring the old one throws', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registered(RETIRED_TASK_NAME)
    native.unregisterTaskAsync.mockRejectedValue(new Error('Task consumer not found'))

    await registerRitualBackgroundTaskAsync()

    expect(native.registerTaskAsync).toHaveBeenCalledWith(TASK_NAME, {
      minimumInterval: 15,
    })
    expect(consoleWarn).toHaveBeenCalledWith(
      '[BackgroundTask] retiring the background fetch task failed',
      expect.any(Error)
    )
  })

  /** Background work is optional; a device that refuses it must still boot. */
  it('swallows a registration failure instead of breaking app start', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    native.isTaskRegisteredAsync.mockRejectedValue(new Error('background refresh denied'))

    await expect(registerRitualBackgroundTaskAsync()).resolves.toBeUndefined()
    expect(consoleWarn).toHaveBeenCalled()
  })
})
