const browserGlobal = globalThis as typeof globalThis & {
  global?: typeof globalThis
}
browserGlobal.global ??= globalThis

import '@testing-library/jest-dom/vitest'
import { cleanup as cleanupDom } from '@testing-library/react'
import { cleanup as cleanupBrowser } from 'vitest-browser-react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

import { server } from './src/test-utils/msw/server'
import { failOnUnwantedConsoleOutput } from './src/test-utils/unwanted-console'

failOnUnwantedConsoleOutput()

// React Native0.81 supplies abort-controller3, which has neither static method, and Hermes
// has no DOMException global.
Reflect.deleteProperty(AbortSignal, 'any')
Reflect.deleteProperty(AbortSignal, 'timeout')
Reflect.deleteProperty(globalThis, 'DOMException')

declare global {
  const __VITEST_WATCH__: boolean
}

beforeAll(async () => {
  // The browser shim forwards worker options. Request traces contain Authorization;
  // quiet leaves handler errors and assertions observable without logging bearers.
  const options = { onUnhandledRequest: 'bypass' as const, quiet: true }
  // eslint-disable-next-line @typescript-eslint/await-thenable
  await server.listen(options)
})

beforeEach(() => {
  Reflect.deleteProperty(AbortSignal, 'any')
  Reflect.deleteProperty(AbortSignal, 'timeout')
  Reflect.deleteProperty(globalThis, 'DOMException')
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
