import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Execute the helpers used by the genuine browser journeys. A routed response
// can finish before a later browser task, which these event controls reproduce.
const source = fs.readFileSync('playwright/tests/share-card-export.spec.ts', 'utf8')
const start = source.indexOf('const cancellationWitness =')
const end = source.indexOf('\nfunction renderCatalog(', start)
if (start === -1 || end === -1) throw new Error('cancellation helpers moved')
const javascript = transpileModule(source.slice(start, end), {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText

type Probe = { inflight: Promise<unknown>[]; handoffs: number }
const nextTask = () => new Promise<void>((resolve) => setImmediate(resolve))
class FakeResponse {
  constructor(readonly url: string) {}
  json() {
    return Promise.resolve({})
  }
  text() {
    return Promise.resolve('')
  }
  arrayBuffer() {
    return Promise.resolve(new ArrayBuffer(0))
  }
  blob() {
    return Promise.resolve(null)
  }
}
class FakeElement {
  clicked = 0
  click() {
    this.clicked += 1
  }
}
class FakeAnchor extends FakeElement {
  download = ''
}
// Each case gets a fresh window, so a probe never leaks between cases. A digest
// settles on a later task, as the browser's does.
function load() {
  const window = {
    fetch: vi.fn((input: string | { url: string }) =>
      Promise.resolve(new FakeResponse(typeof input === 'string' ? input : input.url))
    ),
    Response: FakeResponse,
    HTMLElement: FakeElement,
    HTMLAnchorElement: FakeAnchor,
    crypto: {
      subtle: {
        digest: vi.fn(() => nextTask().then(() => new ArrayBuffer(32))),
      },
    },
    __shareCardHandoffProbe: undefined as Probe | undefined,
  }
  const helpers = vm.runInNewContext(
    `${javascript}\n({ cancellationWitness, expectNoLateDownload, handoffProbe })`,
    { expect, Error, window, MessageChannel }
  ) as {
    cancellationWitness: (page: FakePage, request: object) => Promise<boolean>
    expectNoLateDownload: (page: FakePage) => Promise<void>
    handoffProbe: () => void
  }
  return { window, helpers }
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
  // The page function runs against the same fake window the probe was installed in.
  evaluate<T>(pageFunction: () => Promise<T>) {
    return pageFunction()
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
function downloadClick() {
  const anchor = new FakeAnchor()
  anchor.download = 'couturecast-card.png'
  anchor.click()
}
afterEach(() => vi.useRealTimers())

describe('cancellationWitness', () => {
  it('R2-M2: requires the exact held request, including after unrelated failures', async () => {
    vi.useFakeTimers()
    const page = new FakePage()
    const request = {}
    const result = load().helpers.cancellationWitness(page, request)
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
    const result = load().helpers.cancellationWitness(new FakePage(), {})
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toBe(false)
  })
})

describe('handoffProbe', () => {
  it('tracks share-card preparation fetches, their body reads and digests only', async () => {
    const { window, helpers } = load()
    helpers.handoffProbe()
    const probe = window.__shareCardHandoffProbe!
    await window.fetch('http://127.0.0.1:4088/api/v1/community/feed')
    expect(probe.inflight).toHaveLength(0)
    const prepared = await window.fetch({
      url: 'http://127.0.0.1:4088/api/v1/share-cards/prepare',
    })
    expect(probe.inflight).toHaveLength(1)
    await prepared.json()
    expect(probe.inflight).toHaveLength(2)
    await new FakeResponse('http://127.0.0.1:4088/api/v1/ritual').text()
    expect(probe.inflight).toHaveLength(2)
    await window.crypto.subtle.digest()
    expect(probe.inflight).toHaveLength(3)
  })

  it('counts only download anchor clicks and still performs every click', () => {
    const { window, helpers } = load()
    helpers.handoffProbe()
    const plain = new FakeAnchor()
    plain.click()
    const download = new FakeAnchor()
    download.download = 'couturecast-card.png'
    download.click()
    expect([plain.clicked, download.clicked]).toEqual([1, 1])
    expect(window.__shareCardHandoffProbe!.handoffs).toBe(1)
  })
})

describe('expectNoLateDownload', () => {
  it('R2-M3: stays pending while a held preparation is unsettled, then passes without a handoff', async () => {
    const { window, helpers } = load()
    helpers.handoffProbe()
    const held = deferred()
    window.__shareCardHandoffProbe!.inflight.push(held.promise)
    let settled = false
    const result = helpers.expectNoLateDownload(new FakePage()).then(() => {
      settled = true
    })
    await nextTask()
    await nextTask()
    expect(settled).toBe(false)
    held.resolve()
    await result
    expect(settled).toBe(true)
  })

  it('R2-M3: fails a handoff that a released response continues through microtasks', async () => {
    const { window, helpers } = load()
    helpers.handoffProbe()
    const held = deferred()
    window.__shareCardHandoffProbe!.inflight.push(held.promise)
    void held.promise
      .then(() => Promise.resolve())
      .then(() => Promise.resolve())
      .then(downloadClick)
    const outcome = helpers.expectNoLateDownload(new FakePage()).then(
      () => 'passed',
      () => 'rejected'
    )
    held.resolve()
    expect(await outcome).toBe('rejected')
  })

  it('R2-M3: fails a handoff that first waits on tracked digests settling on later tasks', async () => {
    const { window, helpers } = load()
    helpers.handoffProbe()
    const held = deferred()
    window.__shareCardHandoffProbe!.inflight.push(held.promise)
    void held.promise.then(async () => {
      await window.crypto.subtle.digest()
      await window.crypto.subtle.digest()
      downloadClick()
    })
    const outcome = helpers.expectNoLateDownload(new FakePage()).then(
      () => 'passed',
      () => 'rejected'
    )
    held.resolve()
    expect(await outcome).toBe('rejected')
  })

  it('names a missing probe instead of passing', async () => {
    await expect(load().helpers.expectNoLateDownload(new FakePage())).rejects.toThrow(
      'share_card_handoff_probe_missing'
    )
  })
})
