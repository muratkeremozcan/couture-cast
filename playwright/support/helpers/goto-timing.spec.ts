import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { attachGotoTimingOnFailure, type GotoTiming } from './goto-timing'

const mainFrame = { name: 'main' }
const childFrame = { name: 'child' }
const browserTiming = {
  startTime: 1000,
  domainLookupStart: -1,
  domainLookupEnd: -1,
  connectStart: 0,
  secureConnectionStart: -1,
  connectEnd: 1,
  requestStart: 2,
  responseStart: 40,
  responseEnd: -1,
}
function request(frame: object, navigation = true) {
  return {
    isNavigationRequest: () => navigation,
    frame: () => frame,
    timing: () => browserTiming,
  }
}
type Step = (
  emit: (event: string, value?: unknown) => void,
  tick: (ms: number) => void
) => void
function harness(steps: Step[], failure?: Error) {
  let clock = 0
  const tick = (ms: number) => {
    clock += ms
  }
  const emitter = new EventEmitter()
  const emit = (event: string, value?: unknown) => emitter.emit(event, value)
  const page = {
    on: (event: string, listener: (value: unknown) => void) =>
      emitter.on(event, listener),
    off: (event: string, listener: (value: unknown) => void) =>
      emitter.off(event, listener),
    mainFrame: () => mainFrame,
    goto: vi.fn((_url: string, _options?: { timeout?: number }) => {
      for (const step of steps) step(emit, tick)
      return failure ? Promise.reject(failure) : Promise.resolve(null)
    }),
  }
  const attach = vi.fn((_name: string, _options: { body: string; contentType: string }) =>
    Promise.resolve()
  )
  attachGotoTimingOnFailure(page as never, { attach } as never, () => clock)
  return { page, attach, emitter }
}
const timing = (attach: ReturnType<typeof harness>['attach']) =>
  JSON.parse(attach.mock.calls[0]![1].body) as GotoTiming

describe('page.goto timing attachment', () => {
  it('attaches request start, first byte and the absent load of a timed-out navigation, then rethrows', async () => {
    const navigation = request(mainFrame)
    const timeout = new Error('page.goto: Timeout 30000ms exceeded.\nCall log: secret')
    const f = harness(
      [
        (emit, tick) => {
          tick(5)
          emit('request', request(childFrame))
          emit('request', request(mainFrame, false))
          emit('request', navigation)
        },
        (emit, tick) => {
          tick(45)
          emit('response', { request: () => request(mainFrame), status: () => 500 })
          emit('response', { request: () => navigation, status: () => 200 })
          tick(10)
          emit('domcontentloaded')
          tick(30000)
        },
      ],
      timeout
    )
    await expect(f.page.goto('/', { timeout: 30000 })).rejects.toBe(timeout)
    expect(f.attach).toHaveBeenCalledTimes(1)
    expect(f.attach.mock.calls[0]![0]).toBe('page-goto-timing')
    expect(f.attach.mock.calls[0]![1].contentType).toBe('application/json')
    expect(timing(f.attach)).toEqual({
      url: '/',
      timeoutMs: 30000,
      failedAtMs: 30060,
      requestStartMs: 5,
      firstByteMs: 50,
      responseStatus: 200,
      domContentLoadedMs: 60,
      loadMs: null,
      browser: browserTiming,
      error: 'page.goto: Timeout 30000ms exceeded.',
    })
    for (const event of ['request', 'response', 'domcontentloaded', 'load'])
      expect(f.emitter.listenerCount(event)).toBe(0)
  })
  it('reports a navigation that never started as nulls', async () => {
    const f = harness(
      [(_emit, tick) => tick(7)],
      new Error('net::ERR_CONNECTION_REFUSED')
    )
    await expect(f.page.goto('/community')).rejects.toThrow('ERR_CONNECTION_REFUSED')
    expect(timing(f.attach)).toMatchObject({
      url: '/community',
      timeoutMs: null,
      failedAtMs: 7,
      requestStartMs: null,
      firstByteMs: null,
      loadMs: null,
      browser: null,
    })
  })
  it('attaches nothing when the navigation loads', async () => {
    const f = harness([
      (emit, tick) => {
        emit('request', request(mainFrame))
        tick(3)
        emit('load')
      },
    ])
    await expect(f.page.goto('/')).resolves.toBeNull()
    expect(f.attach).not.toHaveBeenCalled()
    expect(f.emitter.listenerCount('load')).toBe(0)
  })
  it('wraps a page once', async () => {
    const f = harness([], new Error('failed'))
    attachGotoTimingOnFailure(f.page as never, { attach: f.attach } as never)
    await expect(f.page.goto('/')).rejects.toThrow('failed')
    expect(f.attach).toHaveBeenCalledTimes(1)
  })
})
