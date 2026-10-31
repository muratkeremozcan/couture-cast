// Every web test project registers jest-dom's matchers (vitest.setup.ts), and jest-dom's
// toHaveTextContent accepts a RegExp. Vitest 5's browser-mode typings, which enter this
// program through the browser configs, narrow the argument to string | number. This
// restores the signature of the matcher that actually runs. It lives in a declaration
// file because the Assertion declarations of vitest, @vitest/browser and jest-dom do not
// share identical type parameters, which only skipLibCheck tolerates.
import 'vitest'

declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void> {
    toHaveTextContent(
      text?: string | number | RegExp,
      options?: { normalizeWhitespace: boolean }
    ): R
  }
}
