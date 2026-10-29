// Suite-wide guard for signals that only a broken test environment produces.
//
// Each one means an Expo package loaded without what Expo's own toolchain gives it:
// babel-preset-expo's EXPO_OS inline, Expo's web global (globalThis.expo) and web
// constants module, or the native module behind a platform path a test simulates without
// mocking. The console patterns are scoped to these messages, so a test that injects a
// failure on purpose (ritual-cache-ordering's "disk full") still logs freely.
//
// Everything stays installed for the whole file, because an Expo package often loads from
// a lazy import that settles after its test ended. A signal between tests is reported by
// the next test's afterEach, or by afterAll after the last one. A signal after afterAll is
// thrown as an uncaught error, which Vitest reports and fails the run on.
import { afterAll, afterEach, expect } from 'vitest'

export const unwantedConsolePatterns = [
  /process\.env\.EXPO_OS is not defined/,
  /No native ExponentConstants module found/,
  /\[RitualCache\][\s\S]*EventEmitter/,
]

const seen: string[] = []
let finished = false

/** Records an environment failure that app code may have caught and swallowed. */
export function reportUnwantedEnvironmentSignal(entry: string) {
  if (!finished) seen.push(entry)
  else
    setTimeout(() => {
      throw new Error(`Unwanted test-environment signal after the last test: ${entry}`)
    }, 0)
}

/**
 * Expo packages read globalThis.expo while they load and throw when it is missing. App
 * code catches most lazy-load failures, so the read itself is the signal. Call this after
 * Expo's web global is installed; any read that finds it missing is reported.
 */
export function reportMissingExpoGlobalReads() {
  let value: unknown = (globalThis as { expo?: unknown }).expo
  Object.defineProperty(globalThis, 'expo', {
    configurable: true,
    get() {
      if (value === undefined)
        reportUnwantedEnvironmentSignal(
          'an Expo package read globalThis.expo before the Expo web global was installed'
        )
      return value
    },
    set(next: unknown) {
      value = next
    },
  })
}

function render(args: unknown[]) {
  return args
    .map((value) =>
      value instanceof Error ? `${value.name}: ${value.message}` : String(value)
    )
    .join(' ')
}

export function failOnUnwantedConsoleOutput() {
  for (const channel of ['warn', 'error'] as const) {
    const forward = console[channel].bind(console)
    console[channel] = (...args: unknown[]) => {
      forward(...args)
      const text = render(args)
      if (unwantedConsolePatterns.some((pattern) => pattern.test(text)))
        reportUnwantedEnvironmentSignal(`${channel}: ${text}`)
    }
  }
  const check = () => {
    const found = seen.splice(0)
    expect(found, 'unwanted signals from the test environment').toEqual([])
  }
  afterEach(check)
  afterAll(() => {
    finished = true
    check()
  })
}
