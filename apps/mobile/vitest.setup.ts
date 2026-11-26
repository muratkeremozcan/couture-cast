const browserGlobal = globalThis as typeof globalThis & {
  global?: typeof globalThis
}
browserGlobal.global ??= globalThis

import '@testing-library/jest-dom/vitest'
import { cleanup as cleanupDom } from '@testing-library/react'
import { cleanup as cleanupBrowser } from 'vitest-browser-react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

import i18next from 'i18next'

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

// A browser worker runs many test files in one page, and a file that switched the language left
// it behind twice: in i18next, and in the saved settings (`couture-cast-settings.json` in
// localStorage), which the next file's initI18n reads back as its locale.
// community-post-text-editor then read Keine Änderungen for No changes (CI 5f2043f2). Each file
// starts with no saved settings and in en-US. This root hook runs before the file's own hooks,
// so a file that sets its language in beforeAll keeps it. i18next here is the bare singleton
// src/lib/i18n initialises: importing that module would load it, and its storage, before a test
// file's vi.mock could replace them.
beforeAll(async () => {
  globalThis.localStorage?.removeItem('couture-cast-settings.json')
  if (i18next.isInitialized && i18next.language !== 'en-US')
    // eslint-disable-next-line import/no-named-as-default-member -- the instance method, on purpose
    await i18next.changeLanguage('en-US')
})

beforeAll(async () => {
  // The browser shim forwards worker options. Request traces contain Authorization;
  // quiet leaves handler errors and assertions observable without logging bearers.
  const options = { onUnhandledRequest: 'bypass' as const, quiet: true }
  // eslint-disable-next-line @typescript-eslint/await-thenable
  await server.listen(options)
})

beforeEach(async () => {
  Reflect.deleteProperty(AbortSignal, 'any')
  Reflect.deleteProperty(AbortSignal, 'timeout')
  Reflect.deleteProperty(globalThis, 'DOMException')
  // Clear the DOM before each test to prevent pollution/leaks when running tests sequentially
  cleanupDom()
  await cleanupBrowser()
})

afterEach(async () => {
  // Skip cleanup in watch mode (Vitest UI) to keep the last test's component UI mounted for visual inspection
  if (!__VITEST_WATCH__) {
    cleanupDom()
    await cleanupBrowser()
  }
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
