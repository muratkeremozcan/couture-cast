import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import './src/app/globals.css'

type MswController = {
  use: (...handlers: RequestHandler[]) => void
  resetHandlers: () => void
  stop: () => void
}

let mockServer: MswController | null = null

function onUnhandledApiRequest(request: { method: string; url: string }) {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) {
    throw new Error(
      `[MSW] Unhandled API request in tests: ${request.method} ${url.pathname}`
    )
  }
}

function shouldUseBrowserWorker() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  mockServer?.resetHandlers()
})

beforeAll(async () => {
  if (shouldUseBrowserWorker()) {
    const { worker } = await import('./src/test-utils/msw/browser')

    await worker.start({
      serviceWorker: {
        url: '/mockServiceWorker.js',
      },
      quiet: true,
      onUnhandledRequest: onUnhandledApiRequest,
    })

    if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
      let attempts = 0
      while (!navigator.serviceWorker.controller && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        attempts += 1
      }
    }

    mockServer = {
      use: (...handlers) => worker.use(...handlers),
      resetHandlers: () => worker.resetHandlers(),
      stop: () => worker.stop(),
    }
    globalThis.__MSW_RUNTIME_CONTROLLER__ = mockServer
    return
  }

  const { server } = await import('./src/test-utils/msw/server')
  server.listen({
    onUnhandledRequest: onUnhandledApiRequest,
  })
  mockServer = {
    use: (...handlers) => server.use(...handlers),
    resetHandlers: () => server.resetHandlers(),
    stop: () => server.close(),
  }
  globalThis.__MSW_RUNTIME_CONTROLLER__ = mockServer
})

afterAll(() => {
  mockServer?.stop()
  mockServer = null
  globalThis.__MSW_RUNTIME_CONTROLLER__ = undefined
})

/**
 * Pin the browser language for the whole suite.
 *
 * Web locale resolution falls back to `navigator.languages`, so any test that
 * asserts user-visible copy would otherwise depend on the ambient locale of the
 * machine or CI image running it. Pinning removes that non-determinism; locale
 * resolution itself is covered explicitly in the i18n parity spec.
 */
Object.defineProperty(window.navigator, 'languages', {
  configurable: true,
  get: () => ['en-US'],
})
Object.defineProperty(window.navigator, 'language', {
  configurable: true,
  get: () => 'en-US',
})
