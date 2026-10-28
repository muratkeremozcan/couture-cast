import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { talkbackFailureSummary } from './story68-talkback-failure.mjs'

const CLASS = 'expo.modules.accessibilityfocus.ShareCardComposerTalkBackTest'
const frame = (line) =>
  `\tat ${CLASS}.actualTalkBackOpenSaveCancelTraversalAndFocus(ShareCardComposerTalkBackTest.kt:${line})`
const block = (n, exception, ...stack) =>
  `${n}) actualTalkBackOpenSaveCancelTraversalAndFocus(${CLASS})\n${exception}\n${stack.join('\n')}\n`

const failed = `INSTRUMENTATION_STATUS: class=${CLASS}
Time: 41.2
There was 1 failure:
${block(1, 'java.lang.AssertionError: Saved status: null:Maria Private:note, share-card-save:null:Save to photos', '\tat org.junit.Assert.fail(Assert.java:89)', frame(102))}
FAILURES!!!
Tests run: 2,  Failures: 1
`

test('a failed run names the test, assertion head and test frame and drops the node dump', () => {
  const summary = talkbackFailureSummary(failed)
  assert.deepEqual(summary, {
    ok: false,
    tests: 2,
    instrumentationFailed: false,
    failures: [
      {
        test: 'actualTalkBackOpenSaveCancelTraversalAndFocus',
        assertion: 'Saved status',
        frame: 'ShareCardComposerTalkBackTest.kt:102',
      },
    ],
  })
  assert.doesNotMatch(JSON.stringify(summary), /Maria|Private|share-card-save/)
})

test('a bare AssertionError without a message is still located by its test frame', () => {
  const output = `There was 1 failure:\n${block(1, 'java.lang.AssertionError', '\tat org.junit.Assert.fail(Assert.java:89)', '\tat org.junit.Assert.assertTrue(Assert.java:42)', frame(96))}\nFAILURES!!!\nTests run: 2,  Failures: 1\n`
  assert.deepEqual(talkbackFailureSummary(output).failures, [
    {
      test: 'actualTalkBackOpenSaveCancelTraversalAndFocus',
      assertion: 'java.lang.AssertionError',
      frame: 'ShareCardComposerTalkBackTest.kt:96',
    },
  ])
})

test('ComparisonFailure and non-Error exceptions are reported, with values dropped', () => {
  const output = [
    block(
      1,
      'org.junit.ComparisonFailure: expected:<[Maria]> but was:<[Other]>',
      frame(120)
    ),
    block(2, 'java.lang.SecurityException: Permission denied for pid 1234', frame(130)),
    'FAILURES!!!\nTests run: 2,  Failures: 2\n',
  ].join('')
  const { failures } = talkbackFailureSummary(output)
  assert.deepEqual(
    failures.map((f) => [f.assertion, f.frame]),
    [
      ['expected', 'ShareCardComposerTalkBackTest.kt:120'],
      ['Permission denied for pid 1234', 'ShareCardComposerTalkBackTest.kt:130'],
    ]
  )
  assert.doesNotMatch(JSON.stringify(failures), /Maria|Other/)
})

test('frames outside the test class are never taken and malformed at-lines are ignored', () => {
  const output = `${block(1, 'java.lang.AssertionError: Boom', '\tat other.Helper.run(Helper.kt:7)', '\tat expo.Fake.ShareCardComposerTalkBackTest.x(ShareCardComposerTalkBackTest.kt:abc)', '\tat expo.Other.ShareCardComposerTalkBackTestX.y(Other.kt:9)')}FAILURES!!!\n`
  assert.equal(talkbackFailureSummary(output).failures[0].frame, null)
})

test('long alphanumeric tokens are dropped from the assertion head', () => {
  const secret = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1'
  const output = block(1, `java.lang.AssertionError: Missing ${secret} header`, frame(88))
  const [{ assertion }] = talkbackFailureSummary(output).failures
  assert.equal(assertion, 'Missing  header')
  assert.doesNotMatch(assertion, new RegExp(secret))
})

test('a passing run, an instrumentation crash and an unparsed failure are told apart', () => {
  assert.deepEqual(talkbackFailureSummary('\nOK (2 tests)\n'), {
    ok: true,
    tests: 2,
    instrumentationFailed: false,
    failures: [],
  })
  const crash = talkbackFailureSummary('INSTRUMENTATION_FAILED: x/y\n')
  assert.equal(crash.ok, false)
  assert.equal(crash.instrumentationFailed, true)
  assert.deepEqual(crash.failures, [
    { test: 'instrumentation', assertion: 'INSTRUMENTATION_FAILED', frame: null },
  ])
  for (const output of ['garbage', undefined, '']) {
    const summary = talkbackFailureSummary(output)
    assert.equal(summary.ok, false)
    assert.equal(summary.failures.length, 1)
  }
})

test('a message without a dump is kept whole', () => {
  const output = block(
    1,
    'java.lang.AssertionError: Actual TalkBack touch exploration required',
    frame(75)
  )
  assert.equal(
    talkbackFailureSummary(output).failures[0].assertion,
    'Actual TalkBack touch exploration required'
  )
})

test('null-pointer and custom exceptions without a message are located by class and frame', () => {
  const output = [
    block(
      1,
      'java.lang.NullPointerException',
      '\tat kotlin.Intrinsics.checkNotNull(Unknown Source)',
      frame(140)
    ),
    block(
      2,
      'androidx.test.espresso.NoMatchingViewException: No views in hierarchy',
      frame(150)
    ),
    'FAILURES!!!\n',
  ].join('')
  assert.deepEqual(
    talkbackFailureSummary(output).failures.map((f) => [f.assertion, f.frame]),
    [
      ['java.lang.NullPointerException', 'ShareCardComposerTalkBackTest.kt:140'],
      ['No views in hierarchy', 'ShareCardComposerTalkBackTest.kt:150'],
    ]
  )
})

test('the harness prints the closed summary before it throws the composer failure', () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
    'utf8'
  )
  assert.match(
    source,
    /console\.log\(JSON\.stringify\(\{ talkbackComposer: talkbackFailureSummary\(output\) \}\)\)\s*throw new Error\('actual_talkback_composer_failed'\)/
  )
  assert.equal(
    source.split("throw new Error('actual_talkback_composer_failed')").length,
    2
  )
})
