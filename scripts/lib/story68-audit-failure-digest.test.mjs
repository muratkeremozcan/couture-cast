import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import {
  failedAuditIssues,
  failedAuditTestDigest,
  xcodebuildFailureReport,
} from './share-card-audit-report.mjs'

const log = [
  "Test Case '-[ShareCardAccessibilityUITests.ShareCardAccessibilityUITests testAllLocales]' started.",
  '<unknown>:0: error: -[ShareCardAccessibilityUITests.ShareCardAccessibilityUITests testAllLocales] : Missing trait',
  "Test Case '-[ShareCardAccessibilityUITests.ShareCardAccessibilityUITests testAllLocales]' passed (9.0 seconds).",
  "Test Case '-[ShareCardAccessibilityUITests.ShareCardAccessibilityUITests testOpenSave]' started.",
  '    t =    19.72s Tap "tab-home" Any',
  '    t =    21.91s Performing accessibility audit',
  '',
  '/Users/runner/work/x/ShareCardAccessibilityUITests.swift:282: error: -[ShareCardAccessibilityUITests.ShareCardAccessibilityUITests testOpenSave] : Contrast failed',
  '    t =    22.00s Tear Down',
  "Test Case '-[ShareCardAccessibilityUITests.ShareCardAccessibilityUITests testOpenSave]' failed (22.1 seconds).",
].join('\n')

describe('failed audit test digest', () => {
  test('keeps only the failed test, its steps and its first assertion', () => {
    const [digest, ...rest] = failedAuditTestDigest(log)
    assert.equal(rest.length, 0)
    assert.equal(digest.test, 'testOpenSave')
    assert.deepEqual(digest.lines.slice(0, 2), [
      't =    19.72s Tap "tab-home" Any',
      't =    21.91s Performing accessibility audit',
    ])
    assert.match(digest.lines[2], /^ShareCardAccessibilityUITests\.swift:282: error: /)
    assert.ok(digest.lines.every((line) => !line.includes('/Users/')))
  })

  test('is empty when every test passed', () => {
    assert.deepEqual(failedAuditTestDigest(log.split('\n').slice(0, 3).join('\n')), [])
  })

  test('caps the digest size', () => {
    const noisy = [
      "Test Case '-[A.B testX]' started.",
      ...Array.from({ length: 200 }, (_, i) => `    t = ${i}s ${'x'.repeat(900)}`),
      '/a/b/C.swift:1: error: boom',
      ...Array.from({ length: 200 }, () => 'y'.repeat(900)),
      "Test Case '-[A.B testX]' failed (1.0 seconds).",
    ].join('\n')
    const [digest] = failedAuditTestDigest(noisy)
    assert.ok(digest.lines.length <= 24)
    assert.ok(digest.lines.every((line) => line.length <= 300))
  })

  test('the runner prints the digest before it throws', () => {
    const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
    const print = source.indexOf('tests: failedAuditTestDigest(auditText)')
    const thrown = source.indexOf("throw new Error('ios_accessibility_audit_failed')")
    assert.ok(print > 0 && print < thrown)
  })

  test('lists the audit issues the Swift handler refused, in order', () => {
    const issues = failedAuditIssues(
      [
        'CC68_STATE_PASS en-US open on',
        'CC68_AUDIT_ISSUE home|3|outfit-card|Today|Contrast failed',
        '    t = 1s Tear Down',
        'CC68_AUDIT_ISSUE open|2|none|none|Potentially inaccessible text',
        'x'.repeat(10) + ' CC68_AUDIT_ISSUE not-at-line-start|1|a|b|c',
      ].join('\n')
    )
    assert.deepEqual(issues, [
      'home|3|outfit-card|Today|Contrast failed',
      'open|2|none|none|Potentially inaccessible text',
    ])
  })

  test('caps the issue list and each issue line', () => {
    const issues = failedAuditIssues(
      Array.from({ length: 100 }, () => `CC68_AUDIT_ISSUE ${'z'.repeat(900)}`).join('\n')
    )
    assert.equal(issues.length, 40)
    assert.ok(issues.every((line) => line.length <= 400))
  })

  test('the Swift audits name every refused issue and still fail on it', () => {
    const swift = fs.readFileSync(
      'apps/mobile/native-tests/ShareCardAccessibilityUITests.swift',
      'utf8'
    )
    const audits = [...swift.matchAll(/performAccessibilityAudit\(for: \.all\)/g)]
    const handled = [
      ...swift.matchAll(/performAccessibilityAudit\(for: \.all\) \{ issue in/g),
    ]
    assert.equal(audits.length, handled.length)
    assert.match(
      swift,
      /performAccessibilityAudit\(for: \.all\) \{ issue in\n\s+print\(shareCardAuditIssueLine\("home", issue\)\)\n\s+shareCardAuditContextLines\("home", self\.app\)\.forEach \{ print\(\$0\) \}\n\s+return false\n/
    )
    assert.match(
      swift,
      /element\("tab-home"\)\.tap\(\)\n\s+try settleHome\(\)\n\s+try app\.performAccessibilityAudit/
    )
    assert.match(
      swift,
      /if !allowed \{ print\(shareCardAuditIssueLine\(state, issue\)\) \}\n\s+return allowed/
    )
  })

  test('the failure report falls back to the log tail when no test case failed', () => {
    const report = xcodebuildFailureReport(
      Array.from(
        { length: 30 },
        (_, i) => `line ${i} /Users/runner/x/A.swift:3: boom`
      ).join('\n')
    )
    assert.deepEqual(report.tests, [])
    assert.equal(report.tail.length, 12)
    assert.ok(report.tail.every((line) => !line.includes('/Users/')))
    assert.equal(xcodebuildFailureReport(log).tail.length, 0)
    assert.equal(xcodebuildFailureReport(log).tests[0].test, 'testOpenSave')
  })

  test('the fallback XCUITest names every refused issue through the shared helper', () => {
    const swift = fs.readFileSync(
      'apps/mobile/native-tests/ShareCardFallbackUITests.swift',
      'utf8'
    )
    assert.match(
      swift,
      /performAccessibilityAudit\(for: \.all\) \{ issue in\n\s+print\(shareCardAuditIssueLine\("fallback", issue\)\)\n\s+return false\n/
    )
    assert.equal([...swift.matchAll(/performAccessibilityAudit/g)].length, 1)
    const query = fs.readFileSync(
      'apps/mobile/native-tests/ShareCardHeaderQuery.swift',
      'utf8'
    )
    assert.match(query, /func shareCardAuditIssueLine\(/)
  })
})
