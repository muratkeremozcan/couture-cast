import '@testing-library/jest-dom/vitest'
import { cleanup as cleanupDom } from '@testing-library/react'
import { cleanup as cleanupBrowser } from 'vitest-browser-react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

import { server } from './src/test-utils/msw/server'

declare global {
  const __VITEST_WATCH__: boolean
}

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/await-thenable
  await server.listen({ onUnhandledRequest: 'bypass' })
})

beforeEach(() => {
  // Clear the DOM before each test to prevent pollution/leaks when running tests sequentially
  cleanupDom()
  cleanupBrowser()
})

afterEach(() => {
  // Skip cleanup in watch mode (Vitest UI) to keep the last test's component UI mounted for visual inspection
  if (!__VITEST_WATCH__) {
    cleanupDom()
    cleanupBrowser()
  }
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
