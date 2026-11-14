// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 P0-07: the JS half of modules/headless-js-timers.
import { describe, expect, it, vi } from 'vitest'

import {
  createHeadlessTimers,
  HEADLESS_TIMERS_TASK_KEY,
  HEADLESS_TIMERS_TIMEOUT_MS,
} from '../../modules/headless-js-timers/scope'

type Provider = () => (data: { scope?: number }) => Promise<void>

type Begin = (scope: number, timeoutMs: number) => Promise<number | null>

function setup(begin = vi.fn<Begin>(() => Promise.resolve(7))) {
  const providers = new Map<string, Provider>()
  const withTimers = createHeadlessTimers({ begin }, (key, provider) => {
    providers.set(key, provider)
  })
  const headlessTask = (scope: number) =>
    providers.get(HEADLESS_TIMERS_TASK_KEY)!()({ scope })
  /** The scope the native side was asked to start, which it hands to the JS task. */
  const startedScope = () => begin.mock.lastCall?.[0] ?? -1
  return { begin, providers, withTimers, headlessTask, startedScope }
}

const settled = async (promise: Promise<unknown>) => {
  let done = false
  void promise.then(() => (done = true))
  await Promise.resolve()
  await Promise.resolve()
  return done
}

describe('the headless JS timers scope', () => {
  it('starts the native scope before the work and holds its JS task until the work ends', async () => {
    const { begin, providers, withTimers, headlessTask, startedScope } = setup()
    expect([...providers.keys()]).toEqual([HEADLESS_TIMERS_TASK_KEY])
    let finishWork: ((value: string) => void) | undefined
    let task: Promise<void> | undefined
    const work = vi.fn(() => {
      // React Native runs the registered task once the native side has started it.
      task = headlessTask(startedScope())
      return new Promise<string>((resolve) => {
        finishWork = resolve
      })
    })

    const result = withTimers(work)
    await vi.waitFor(() => expect(work).toHaveBeenCalled())

    expect(begin).toHaveBeenCalledWith(1, HEADLESS_TIMERS_TIMEOUT_MS)
    expect(await settled(task!)).toBe(false)
    finishWork?.('done')
    await expect(result).resolves.toBe('done')
    expect(await settled(task!)).toBe(true)
  })

  it('releases the JS task when the work fails', async () => {
    const { withTimers, headlessTask, startedScope } = setup()
    let task: Promise<void> | undefined
    const failing = withTimers(() => {
      task = headlessTask(startedScope())
      return Promise.reject(new Error('offline'))
    })

    await expect(failing).rejects.toThrow('offline')
    expect(await settled(task!)).toBe(true)
  })

  it('ends at once a JS task that reaches JS after its work ended', async () => {
    const { withTimers, headlessTask } = setup()
    await withTimers(() => Promise.resolve('fast'))

    expect(await settled(headlessTask(1))).toBe(true)
  })

  it('still runs the work when the native scope cannot start', async () => {
    const begin = vi.fn<Begin>(() => Promise.reject(new Error('no react context')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { withTimers } = setup(begin)

    await expect(withTimers(() => Promise.resolve('ran'))).resolves.toBe('ran')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('runs the work directly and registers nothing without the native module', async () => {
    const register = vi.fn()
    const withTimers = createHeadlessTimers(null, register)

    await expect(withTimers(() => Promise.resolve('ios'))).resolves.toBe('ios')
    expect(register).not.toHaveBeenCalled()
  })
})
