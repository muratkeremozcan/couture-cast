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

  it('adds no handler when MSW_TEST_DELAY_MS is unset, empty or zero', () => {
    for (const value of ['', ' ', '0']) {
      vi.stubEnv('MSW_TEST_DELAY_MS', value)
      expect(delayHandler()).toEqual([])
    }
  })

  it('refuses a delay that is not a finite number from 0 to 1000', () => {
    for (const value of ['soon', '-5', 'Infinity', '-Infinity', 'NaN', '1001', '1e9']) {
      vi.stubEnv('MSW_TEST_DELAY_MS', value)
      expect(() => delayHandler(), value).toThrow(
        /MSW_TEST_DELAY_MS must be a number from 0 to 1000/
      )
    }
    vi.stubEnv('MSW_TEST_DELAY_MS', '1000')
    expect(delayHandler()).toHaveLength(1)
  })

  it('answers immediately when the switch is off', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '')
    useMswHandlers(answer())
    expect(await timedRead()).toBeLessThan(80)
  })

  // Later sets sit in front of the one that answers, so the request falls through every
  // delay handler before it reaches its answer; two delays would take 200 ms.
  const other = (name: string) =>
    http.get(`http://localhost/${name}`, () => HttpResponse.json({}))

  async function expectOneDelay() {
    const elapsed = await timedRead()
    expect(elapsed).toBeGreaterThanOrEqual(90)
    expect(elapsed).toBeLessThan(190)
  }

  it('delays a request by the fixed value exactly once with two handler sets registered', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '100')
    useMswHandlers(answer())
    useMswHandlers(other('other-a'))
    await expectOneDelay()
  })

  it('delays a request by the fixed value exactly once with three handler sets registered', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '100')
    useMswHandlers(answer())
    useMswHandlers(other('other-a'))
    useMswHandlers(other('other-b'))
    await expectOneDelay()
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

  it.each(['0', 'false', ''])('counts MSW_TEST_DELAY_RANDOM=%j as off', async (value) => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '200')
    vi.stubEnv('MSW_TEST_DELAY_RANDOM', value)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    useMswHandlers(answer())
    expect(await timedRead()).toBeGreaterThanOrEqual(190)
  })

  it('does not wait on the clock while fake timers are installed', async () => {
    vi.stubEnv('MSW_TEST_DELAY_MS', '1000')
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
