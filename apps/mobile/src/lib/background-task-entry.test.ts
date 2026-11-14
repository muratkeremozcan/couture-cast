// Story 6.15 P0-07: a headless background wake evaluates only the bundle entry, never a route.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import mobilePackage from '../../package.json'

const native = vi.hoisted(() => ({
  defineTask: vi.fn(),
  routeEvaluated: vi.fn(),
}))

vi.mock('expo-task-manager', () => ({
  defineTask: native.defineTask,
  isTaskRegisteredAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
}))

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  registerTaskAsync: vi.fn(),
}))

// The router entry only registers the root component; rendering it is what evaluates routes,
// and a headless run never renders. The stand-in records a route evaluation if anything asks.
vi.mock('expo-router/entry', () => ({}))
vi.mock('../../app/_layout', () => {
  native.routeEvaluated()
  return {}
})

/** The modules Metro may start the bundle from, keyed by the package.json `main` naming them. */
const bundleEntries: Record<string, () => Promise<unknown>> = {
  'index.ts': () => import('../../index.js'),
  // The stock router entry, mocked above: it imports no task module of the app.
  'expo-router/entry': () => Promise.resolve(),
}

describe('the bundle entry', () => {
  beforeEach(() => {
    native.defineTask.mockClear()
    native.routeEvaluated.mockClear()
  })

  it('defines the ritual background task without evaluating a route', async () => {
    const entry = bundleEntries[mobilePackage.main]
    if (!entry) throw new Error(`Unknown package.json main: ${mobilePackage.main}`)

    await entry()

    expect(native.defineTask).toHaveBeenCalledWith(
      'RITUAL_BACKGROUND_TASK',
      expect.any(Function)
    )
    expect(native.routeEvaluated).not.toHaveBeenCalled()
  })
})
