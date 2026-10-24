// Fails any test that logs a console warning. Register at the top of a suite
// that renders without warnings today, so the next one is a failure, not noise.
//
// Why every warning and not one pattern: react-native-web reports a deprecated
// prop (for example "props.pointerEvents is deprecated. Use style.pointerEvents")
// through `warnOnce`, once per page. The first offender in a file takes the only
// warning, so this must be live from that file's first test, and whichever test
// renders the offender first is the one that fails.
import { afterEach, beforeEach, expect, vi } from 'vitest'

const forward = console.warn.bind(console)

export function failOnConsoleWarn() {
  const warnings: string[] = []
  beforeEach(() => {
    warnings.length = 0
    // Recorded here rather than read off the spy, so a suite's own
    // `vi.restoreAllMocks()` in an earlier afterEach cannot clear the evidence.
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
      forward(...args)
    })
  })
  afterEach(() => {
    expect(warnings).toEqual([])
  })
}
