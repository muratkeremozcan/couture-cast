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

/**
 * Opt-in latency for every mocked response, to expose tests that pass only when a response
 * lands before their first assertion. Off unless MSW_TEST_DELAY_MS is a positive number.
 *
 *   MSW_TEST_DELAY_MS=100                          every request answers 100 ms late
 *   MSW_TEST_DELAY_MS=100 MSW_TEST_DELAY_RANDOM=1  each request waits a uniform 0 to 100 ms
 *
 * Run a spec or the suite with it set, for example
 * `MSW_TEST_DELAY_MS=100 npm exec -- vitest run src/app/components/subscription-section.test.tsx`.
 * Nothing is delayed while fake timers are installed, since the delay would then wait for
 * the test to advance the clock. A request is delayed once however many handler sets the
 * test registers. Tests that pin a latency budget on purpose (the request-ownership specs)
 * fail at large values such as 300, so run the whole suite at 100 or below.
 * Returns no handler when the variable is unset.
 */
const delayed = new Set<string>()

export function delayHandler(): RequestHandler[] {
  const max = Number(process.env.MSW_TEST_DELAY_MS ?? 0)
  if (!(max > 0)) return []
  return [
    http.all('*', async ({ requestId }) => {
      if (vi.isFakeTimers() || delayed.has(requestId)) return
      delayed.add(requestId)
      await delay(process.env.MSW_TEST_DELAY_RANDOM ? Math.random() * max : max)
    }),
  ]
}
