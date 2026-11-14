/// <reference types="vite/client" />
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 P0-07: the JS half of modules/headless-js-timers.
import { describe, expect, it, vi } from 'vitest'

import {
  createHeadlessTimers,
  HEADLESS_TIMERS_TASK_KEY,
  HEADLESS_TIMERS_TIMEOUT_MS,
} from '../../modules/headless-js-timers/scope'
import kotlinModuleSource from '../../modules/headless-js-timers/android/src/main/java/expo/modules/headlessjstimers/HeadlessJsTimersModule.kt?raw'

type Provider = () => (data: { scope?: number }) => Promise<void>

type Begin = (scope: number, timeoutMs: number) => Promise<number | null>

function setup(begin?: Begin) {
  const providers = new Map<string, Provider>()
  const tasks: Promise<void>[] = []
  const headlessTask = (scope: number) =>
    providers.get(HEADLESS_TIMERS_TASK_KEY)!()({ scope })
  // As HeadlessJsTaskContext.startTask does, the native side queues the JS task before begin
  // resolves, so the task can reach JS before the await in the scope returns.
  const nativeBegin = vi.fn<Begin>(
    begin ??
      ((scope) => {
        tasks.push(headlessTask(scope))
        return Promise.resolve(7)
      })
  )
  const withTimers = createHeadlessTimers({ begin: nativeBegin }, (key, provider) => {
    providers.set(key, provider)
  })
  return { begin: nativeBegin, providers, withTimers, headlessTask, tasks }
}

/** The JS task the native side started for call `index`, once `count` calls have started. */
function startedTask(tasks: Promise<void>[], count: number, index = 0): Promise<void> {
  expect(tasks).toHaveLength(count)
  const task = tasks[index]
  if (task === undefined) throw new Error(`no JS task started for call ${index}`)
  return task
}

/** A unit of work that ends when the spec says so. */
function pendingWork() {
  let finish: ((value: string) => void) | undefined
  const work = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  return { work, finish: (value: string) => finish?.(value) }
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
    const { begin, providers, withTimers, tasks } = setup()
    expect([...providers.keys()]).toEqual([HEADLESS_TIMERS_TASK_KEY])
    const { work, finish } = pendingWork()

    const result = withTimers(work)
    await vi.waitFor(() => expect(work).toHaveBeenCalled())

    expect(begin).toHaveBeenCalledWith(1, HEADLESS_TIMERS_TIMEOUT_MS)
    const task = startedTask(tasks, 1)
    expect(await settled(task)).toBe(false)
    finish('done')
    await expect(result).resolves.toBe('done')
    expect(await settled(task)).toBe(true)
  })

  it('gives overlapping work its own scope, so ending one leaves the other task pending', async () => {
    const { begin, withTimers, tasks } = setup()
    const first = pendingWork()
    const second = pendingWork()

    const firstResult = withTimers(first.work)
    const secondResult = withTimers(second.work)
    await vi.waitFor(() => expect(second.work).toHaveBeenCalled())

    expect(begin.mock.calls.map(([scope]) => scope)).toEqual([1, 2])
    const firstTask = startedTask(tasks, 2, 0)
    const secondTask = startedTask(tasks, 2, 1)
    first.finish('one')
    await expect(firstResult).resolves.toBe('one')
    expect(await settled(firstTask)).toBe(true)
    expect(await settled(secondTask)).toBe(false)
    second.finish('two')
    await expect(secondResult).resolves.toBe('two')
    expect(await settled(secondTask)).toBe(true)
  })

  it('releases the JS task when the work fails', async () => {
    const { withTimers, tasks } = setup()
    const failing = withTimers(() => Promise.reject(new Error('offline')))

    await expect(failing).rejects.toThrow('offline')
    const task = startedTask(tasks, 1)
    expect(await settled(task)).toBe(true)
  })

  it('ends at once a JS task that reaches JS after its work ended', async () => {
    const { withTimers, headlessTask } = setup(() => Promise.resolve(7))
    await withTimers(() => Promise.resolve('fast'))

    expect(await settled(headlessTask(1))).toBe(true)
  })

  it('still runs the work when the native scope cannot start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { withTimers } = setup(() => Promise.reject(new Error('no react context')))

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

  it('registers the task key the native module starts', () => {
    // The key lives in Kotlin and in scope.ts; a mismatch starts a task no JS answers.
    const declared = [
      ...kotlinModuleSource.matchAll(/const val HEADLESS_TIMERS_TASK_KEY = "([^"]*)"/g),
    ]
    expect(declared.map((match) => match[1])).toEqual([HEADLESS_TIMERS_TASK_KEY])
  })
})
