import { delay, http, type RequestHandler } from 'msw'
import { vi } from 'vitest'

type MswController = {
  use: (...handlers: RequestHandler[]) => void
}

declare global {
  // eslint-disable-next-line no-var
  var __MSW_RUNTIME_CONTROLLER__: MswController | undefined
}

export function useMswHandlers(...handlers: RequestHandler[]) {
  const controller = globalThis.__MSW_RUNTIME_CONTROLLER__
  if (!controller) {
    throw new Error('MSW runtime controller is not initialized in vitest.setup.ts')
  }
  controller.use(...delayHandler(), ...handlers)
}

const MAX_DELAY_MS = 1000
const OFF = new Set(['', '0', 'false'])
const delayed = new WeakSet<Request>()

// vitest browser mode has no process; the delay is then simply off.
const env = (name: string): string | undefined =>
  typeof process === 'undefined' ? undefined : process.env[name]

function configuredDelay(): number {
  const raw = env('MSW_TEST_DELAY_MS')?.trim() ?? ''
  if (raw === '') return 0
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > MAX_DELAY_MS) {
    throw new Error(
      `MSW_TEST_DELAY_MS must be a number from 0 to ${MAX_DELAY_MS}, got ${raw}`
    )
  }
  return value
}

/**
 * Opt-in latency for every mocked response, to expose tests that pass only when a response
 * lands before their first assertion. Off unless MSW_TEST_DELAY_MS is a number from 1 to
 * 1000; empty or 0 is off, anything else that is not a finite number in range throws.
 *
 *   MSW_TEST_DELAY_MS=100                          every request answers 100 ms late
 *   MSW_TEST_DELAY_MS=100 MSW_TEST_DELAY_RANDOM=1  each request waits a uniform 0 to 100 ms
 *
 * MSW_TEST_DELAY_RANDOM counts as off when it is unset, empty, 0 or false. Run a spec or
 * the suite with the switch set, for example
 * `MSW_TEST_DELAY_MS=100 npm exec -- vitest run src/app/components/subscription-section.test.tsx`
 * (see the testing section of apps/web/README.md). Nothing is delayed while fake timers are
 * installed, since the delay would then wait for the test to advance the clock. A request
 * is delayed once however many handler sets the test registers, because every set puts a
 * delay handler in front of its own handlers and a request falls through all of them.
 * Tests that pin a latency budget on purpose (the request-ownership specs) fail at large
 * values, so run the whole suite at 100 or below.
 */
export function delayHandler(): RequestHandler[] {
  const max = configuredDelay()
  if (max === 0) return []
  const random = !OFF.has(env('MSW_TEST_DELAY_RANDOM')?.trim().toLowerCase() ?? '')
  return [
    http.all('*', async ({ request }) => {
      // msw gives every handler the same Request object, so the first delay handler to
      // see a request marks it and the ones behind it let it through.
      if (vi.isFakeTimers() || delayed.has(request)) return
      delayed.add(request)
      await delay(random ? Math.random() * max : max)
    }),
  ]
}
