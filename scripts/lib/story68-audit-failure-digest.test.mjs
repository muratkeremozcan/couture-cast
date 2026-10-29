import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { failedAuditTestDigest } from './share-card-audit-report.mjs'

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
    const print = source.indexOf('iosAuditFailure: failedAuditTestDigest(auditText)')
    const thrown = source.indexOf("throw new Error('ios_accessibility_audit_failed')")
    assert.ok(print > 0 && print < thrown)
  })
})
