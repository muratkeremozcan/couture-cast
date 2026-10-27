// Suite-wide guard for console output that only a broken test environment produces.
//
// Both messages below mean an Expo package loaded without what Expo's own toolchain gives
// it: babel-preset-expo's EXPO_OS inline, or the native module behind a platform path a
// test simulates without mocking. Scoped to these messages, so a test that injects a
// failure on purpose (ritual-cache-ordering's "disk full") still logs freely.
//
// The wrapper stays installed for the whole file, because an Expo package often loads
// from a lazy import that settles after its test ended. Output that lands between tests is
// reported by the next test's afterEach, or by afterAll after the last one.
import { afterAll, afterEach, expect } from 'vitest'

export const unwantedConsolePatterns = [
  /process\.env\.EXPO_OS is not defined/,
  /\[RitualCache\][\s\S]*EventEmitter/,
]

function render(args: unknown[]) {
  return args
    .map((value) =>
      value instanceof Error ? `${value.name}: ${value.message}` : String(value)
    )
    .join(' ')
}

export function failOnUnwantedConsoleOutput() {
  const seen: string[] = []
  for (const channel of ['warn', 'error'] as const) {
    const forward = console[channel].bind(console)
    console[channel] = (...args: unknown[]) => {
      const text = render(args)
      if (unwantedConsolePatterns.some((pattern) => pattern.test(text)))
        seen.push(`${channel}: ${text}`)
      forward(...args)
    }
  }
  const check = () => {
    const found = seen.splice(0)
    expect(found, 'unwanted console output from the test environment').toEqual([])
  }
  afterEach(check)
  afterAll(check)
}
