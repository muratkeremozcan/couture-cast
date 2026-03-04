import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import './src/app/globals.css'

import { worker } from './src/test-utils/msw/browser'

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  worker.resetHandlers()
})

beforeAll(async () => {
  await worker.start({
    serviceWorker: {
      url: '/mockServiceWorker.js',
    },
    quiet: true,
    onUnhandledRequest(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/api/')) {
        throw new Error(
          `[MSW] Unhandled API request in tests: ${request.method} ${url.pathname}`
        )
      }
    },
  })

  if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
    let attempts = 0
    while (!navigator.serviceWorker.controller && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts += 1
    }
  }
})

afterAll(() => {
  worker.stop()
})
