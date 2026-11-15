import { beforeAll } from 'vitest'

// pr-checks' unit-tests-year-ahead job moves the real clock through scripts/ci/real-clock-offset.mjs.
// A worker that did not load it would pass on today's clock, so the run stops instead.
if (
  Number(process.env.REAL_CLOCK_OFFSET_DAYS ?? 0) !== 0 &&
  !(Date as unknown as Record<symbol, unknown>)[
    Symbol.for('couture-cast.real-clock-offset-days')
  ]
) {
  throw new Error('REAL_CLOCK_OFFSET_DAYS is set but this worker runs on the real clock.')
}

// Story 6.17 TEA-14: a unit run never holds a real Auth Admin credential, so a SupabaseAuthAdmin
// built by mistake fails closed. Empty, so a later dotenv load (load-env) cannot refill it.
process.env.SUPABASE_SERVICE_ROLE_KEY = ''

beforeAll(() => {
  const originalFetch =
    globalThis.fetch ||
    (() => {
      throw new Error('fetch is not defined')
    })

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString =
      input instanceof URL
        ? input.toString()
        : typeof input === 'string'
          ? input
          : input.url

    let isForbidden = false
    try {
      const url = new URL(urlString)
      if (
        url.hostname !== 'localhost' &&
        url.hostname !== '127.0.0.1' &&
        url.hostname !== '[::1]' &&
        url.hostname !== '::1'
      ) {
        isForbidden = true
      }
    } catch {
      // Allow relative or invalid URLs to fall through to originalFetch naturally
    }

    if (isForbidden) {
      throw new Error(
        `Forbidden outgoing network request to ${urlString} detected in test! All external network calls must be mocked.`
      )
    }

    return originalFetch(input, init)
  }
})
