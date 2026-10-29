/**
 * Closed summary of an `am instrument` run: pass count and, for every failure, the test name,
 * the head of its assertion message and the first stack frame inside the test class. The text
 * after the first colon is the on-screen node dump (labels, ids, user content), so it is never
 * kept; neither is any long alphanumeric token, which could be an id, digest or secret.
 */
const clean = (value, limit) =>
  value
    .replace(/[A-Za-z0-9]{41,}/g, '')
    .replace(/[^A-Za-z0-9 _.\-/]/g, '_')
    .slice(0, limit)
    .trim()
const MAX_FRAMES = 6
// Test names are source identifiers, so only their charset is restricted.
const identifier = (value) => value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 120)

/**
 * `ShareCardComposerTalkBackTest.kt:102` for every at-line of the test class, in stack order,
 * without repeats. The first is the innermost helper (a wait loop); the next names its caller,
 * which is the step of the journey that failed.
 */
function testFrames(block, className) {
  const simple = className.split(/[.$]/).at(-1)
  const frame = new RegExp(
    String.raw`^\s*at [\w.$]*${simple}[\w$]*\.[\w$<>]+\(${simple}\.kt:(\d{1,5})\)\s*$`,
    'gm'
  )
  return [
    ...new Set([...block.matchAll(frame)].map((match) => `${simple}.kt:${match[1]}`)),
  ].slice(0, MAX_FRAMES)
}

function parseFailures(text) {
  return text.split(/^(?=\d+\) \w+\([\w.$]+\)$)/m).flatMap((block) => {
    const head = /^\d+\) (\w+)\(([\w.$]+)\)\n([\w.$]+)(?:: ([^\n]*))?/.exec(block)
    if (!head) return []
    return [
      {
        test: identifier(head[1]),
        assertion: clean((head[4] ?? '').split(':')[0], 160) || clean(head[3], 160),
        frame: testFrames(block, head[2])[0] ?? null,
        frames: testFrames(block, head[2]),
      },
    ]
  })
}

export function talkbackFailureSummary(output) {
  const text = String(output ?? '')
  const ok = /OK \(\d+ tests?\)/.test(text)
  const instrumentationFailed = /INSTRUMENTATION_FAILED/.test(text)
  let failures = parseFailures(text)
  // A failed run is never reported with an empty failure list.
  if (!ok && failures.length === 0)
    failures = [
      {
        test: instrumentationFailed ? 'instrumentation' : 'unknown',
        assertion: instrumentationFailed ? 'INSTRUMENTATION_FAILED' : 'no_failure_parsed',
        frame: null,
        frames: [],
      },
    ]
  return {
    ok,
    tests: Number(
      /Tests run: (\d+)/.exec(text)?.[1] ?? /OK \((\d+) tests?\)/.exec(text)?.[1] ?? 0
    ),
    instrumentationFailed,
    failures,
  }
}
