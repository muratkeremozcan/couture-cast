import { beforeAll } from 'vitest'

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
