import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { delayHandler, useMswHandlers } from './runtime'

const PATH = 'http://localhost/msw-delay-probe'

async function timedRead() {
  const started = performance.now()
  const response = await fetch(PATH)
  expect(await response.json()).toEqual({ ok: true })
  return performance.now() - started
}
const answer = () => http.get(PATH, () => HttpResponse.json({ ok: true }))

describe('opt-in MSW response delay', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('adds no handler unless MSW_TEST_DELAY_MS is a positive number', () => {
    for (const value of ['', '0', '-5', 'soon']) {
      vi.stubEnv('MSW_TEST_DELAY_MS', value)
      expect(delayHandler()).toEqual([])
    }
  })

  it('answers immediately when the switch is off', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '')
    useMswHandlers(answer())
    expect(await timedRead()).toBeLessThan(80)
  })

  it('delays a request by the fixed value, once, however many handler sets are registered', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '100')
    useMswHandlers(answer())
    useMswHandlers(answer())
    useMswHandlers(answer())
    const elapsed = await timedRead()
    expect(elapsed).toBeGreaterThanOrEqual(90)
    expect(elapsed).toBeLessThan(190)
  })

  it('draws a uniform delay from zero to the value when asked for a random range', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '200')
    vi.stubEnv('MSW_TEST_DELAY_RANDOM', '1')
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    useMswHandlers(answer())
    const elapsed = await timedRead()
    expect(elapsed).toBeGreaterThanOrEqual(90)
    expect(elapsed).toBeLessThan(190)
  })

  it('does not wait on the clock while fake timers are installed', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '5000')
    useMswHandlers(answer())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const resolver = vi.fn()
    const handler = delayHandler()[0]
    expect(handler).toBeDefined()
    // The resolver returns without scheduling a timer, so no clock tick is needed.
    await expect(
      Promise.race([
        (async () => {
          await fetch(PATH)
          resolver()
        })(),
        new Promise((resolve) => setImmediate(resolve)),
      ])
    ).resolves.not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
