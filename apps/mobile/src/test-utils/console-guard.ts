// Fails any test that logs a console warning (or, with failOnConsoleWarnOrError, an error). Register at the top of a suite
// that renders without warnings today, so the next one is a failure, not noise.
//
// Why every warning and not one pattern: react-native-web reports a deprecated
// prop (for example "props.pointerEvents is deprecated. Use style.pointerEvents")
// through `warnOnce`, once per page. The first offender in a file takes the only
// warning, so this must be live from that file's first test, and whichever test
// renders the offender first is the one that fails.
import { afterEach, beforeEach, expect, vi } from 'vitest'

type ConsoleChannel = 'warn' | 'error'

function failOnConsole(channels: readonly ConsoleChannel[]) {
  const output: string[] = []
  beforeEach(() => {
    output.length = 0
    // Recorded here rather than read off the spy, so a suite's own
    // `vi.restoreAllMocks()` in an earlier afterEach cannot clear the evidence.
    for (const channel of channels) {
      const forward = console[channel].bind(console)
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        output.push(`${channel}: ${args.map(String).join(' ')}`)
        forward(...args)
      })
    }
  })
  afterEach(() => {
    expect(output).toEqual([])
  })
}

export function failOnConsoleWarn() {
  failOnConsole(['warn'])
}

/** Also fails on console.error, for suites that render with neither today. */
export function failOnConsoleWarnOrError() {
  failOnConsole(['warn', 'error'])
}
