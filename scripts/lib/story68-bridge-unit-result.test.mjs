// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { bridgeUnitDiagnostics } from './story68-bridge-unit-result.mjs'

const base = () => ({
  result: { status: 0 },
  report: {
    success: true,
    testResults: [{ assertionResults: [{ status: 'passed' }] }],
  },
  log: '',
  matchedCases: 1,
  requiredCases: 1,
})

describe('bridgeUnitDiagnostics', () => {
  test('a successful child requires observed passing assertions and every required case', () => {
    assert.deepEqual(bridgeUnitDiagnostics(base()), {
      classification: 'passed',
      exitCode: 0,
      reportPresent: true,
      reportSuccessful: true,
      assertionsObserved: 1,
      assertionsFailed: 0,
      matchedCases: 1,
      requiredCases: 1,
    })
  })

  test('the actual missing-browser signature explains a misleading successful zero-test report', () => {
    const input = base()
    input.result.status = 1
    input.report.testResults = []
    input.matchedCases = 0
    input.log = "browserType.launch: Executable doesn't exist at /private/member/token"
    const value = bridgeUnitDiagnostics(input)
    assert.equal(value.classification, 'browser_missing')
    assert.equal(value.reportSuccessful, true)
    assert.equal(value.assertionsObserved, 0)
    assert.equal(JSON.stringify(value).includes('/private/member/token'), false)
  })

  test('Linux shared-library bootstrap failures have their own closed classification', () => {
    assert.equal(
      bridgeUnitDiagnostics({ ...base(), log: 'error while loading shared libraries' })
        .classification,
      'browser_dependencies_missing'
    )
  })

  test('spawn errors and termination remain failures with a null exit status', () => {
    for (const result of [
      { status: null, error: new Error('private') },
      { status: null, signal: 'SIGTERM' },
    ])
      assert.equal(
        bridgeUnitDiagnostics({ ...base(), result }).classification,
        'runner_start_failed'
      )
  })

  test('missing and invalid reports remain distinguishable without raw parse errors', () => {
    assert.equal(
      bridgeUnitDiagnostics({ ...base(), report: null }).classification,
      'report_missing'
    )
    assert.equal(
      bridgeUnitDiagnostics({ ...base(), report: null, invalidReport: true })
        .classification,
      'report_invalid'
    )
  })

  test('failed assertions and a nonzero child cannot be classified as passed', () => {
    const input = base()
    input.report.success = false
    input.report.testResults[0].assertionResults[0].status = 'failed'
    assert.equal(bridgeUnitDiagnostics(input).assertionsFailed, 1)
    assert.equal(bridgeUnitDiagnostics(input).classification, 'tests_failed')
    assert.equal(
      bridgeUnitDiagnostics({ ...base(), result: { status: 1 } }).classification,
      'tests_failed'
    )
  })

  test('missing or stale case matches cannot manufacture successful evidence', () => {
    for (const extra of [
      { matchedCases: 0 },
      { requiredCases: 0 },
      { matchedCases: 2, requiredCases: 2 },
    ])
      assert.equal(
        bridgeUnitDiagnostics({ ...base(), ...extra }).classification,
        'assertions_missing'
      )
  })
})
