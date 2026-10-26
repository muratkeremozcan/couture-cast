import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { ScriptTarget, transpileModule } from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'

// Execute the helpers used by the genuine browser journeys. A routed response
// can finish before a later browser task, which these event controls reproduce.
const source = fs.readFileSync('playwright/tests/share-card-export.spec.ts', 'utf8')
const start = source.indexOf('const cancellationWitness =')
const end = source.indexOf('\nasync function ownPhoto(', start)
const javascript = transpileModule(source.slice(start, end), {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText
const helpers = vm.runInNewContext(
  `${javascript}\n({ cancellationWitness, expectNoLateDownload })`,
  { expect, Error }
) as {
  cancellationWitness: (page: FakePage, request: object) => Promise<boolean>
  expectNoLateDownload: (page: FakePage) => Promise<void>
}

class FakePage extends EventEmitter {
  waitForEvent(
    name: string,
    options: { timeout: number; predicate?: (value: object) => boolean }
  ) {
    return new Promise<object>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.off(name, listener)
      }
      const listener = (value: object) => {
        if (options.predicate && !options.predicate(value)) return
        cleanup()
        resolve(value)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(Object.assign(new Error('event deadline'), { name: 'TimeoutError' }))
      }, options.timeout)
      this.on(name, listener)
    })
  }
}
afterEach(() => vi.useRealTimers())

it('R2-M2: cancellation witness requires the exact held request, including after unrelated failures', async () => {
  vi.useFakeTimers()
  const page = new FakePage()
  const request = {}
  const result = helpers.cancellationWitness(page, request)
  let outcome: boolean | undefined
  void result.then((value) => {
    outcome = value
  })
  page.emit('requestfailed', {})
  await vi.advanceTimersByTimeAsync(4999)
  expect(outcome).toBeUndefined()
  page.emit('requestfailed', request)
  expect(await result).toBe(true)
})

it('R2-M2: a route that fulfills without cancellation cannot supply an abort witness', async () => {
  vi.useFakeTimers()
  const result = helpers.cancellationWitness(new FakePage(), {})
  await vi.advanceTimersByTimeAsync(5000)
  expect(await result).toBe(false)
})

it('R2-M3: delayed download after route fulfillment fails the actual bounded browser assertion', async () => {
  vi.useFakeTimers()
  const page = new FakePage()
  const result = helpers.expectNoLateDownload(page)
  const outcome = result.then(
    () => 'passed',
    () => 'rejected'
  )
  await vi.advanceTimersByTimeAsync(20)
  page.emit('download', {})
  expect(await outcome).toBe('rejected')
})

it('R2-M3: no-download assertion stays pending for the entire bounded event window', async () => {
  vi.useFakeTimers()
  const result = helpers.expectNoLateDownload(new FakePage())
  let settled = false
  void result.then(() => {
    settled = true
  })
  await vi.advanceTimersByTimeAsync(999)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await result
  expect(settled).toBe(true)
})
