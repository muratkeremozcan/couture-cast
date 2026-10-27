import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertWebMatrix } from './assert-web-matrix.mjs'
function report() {
  const titles = [
    'P-FOREIGN ',
    'P-REVALIDATE ',
    'P-OUTFIT ',
    'P-CANCEL P-IDENTITY:',
    'P-CANCEL-SAVE:',
  ]
  const suites = [
    'en-US',
    'en-CA',
    'fr-FR',
    'fr-CA',
    'de-DE',
    'es-419',
    'it-IT',
    'pt-BR',
    'pt-PT',
    'tr-TR',
  ].map((locale) => ({
    title: locale,
    specs: [{ id: locale, title: 'P-POST ', tests: [] }],
  }))
  const specs = titles.map((title, id) => ({ id: String(id), title, tests: [] }))
  for (const spec of [...specs, ...suites.flatMap((s) => s.specs)])
    spec.tests = ['chromium', 'firefox', 'webkit'].map((projectName) => ({
      projectName,
      expectedStatus: 'passed',
      status: 'expected',
      results: [{ status: 'passed' }],
    }))
  return { suites: [{ title: 'share-card-export.spec.ts', specs, suites }], errors: [] }
}
const locales = [
  'en-US',
  'en-CA',
  'fr-FR',
  'fr-CA',
  'de-DE',
  'es-419',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'tr-TR',
]

describe('assertWebMatrix', () => {
  test('accepts exactly15 actual passed behaviors per engine and emits only closed summary', () => {
    assert.deepEqual(assertWebMatrix(report()), {
      passed: true,
      cases: 45,
      projects: ['chromium', 'firefox', 'webkit'].map((browser) => ({
        browser,
        passed: 15,
        locales,
      })),
    })
  })

  test('rejects missing engines, skipped or failed cases, missing locale, behavior and duplicate case', () => {
    for (const [change, code] of [
      [
        (r) => {
          r.suites[0].specs[0].tests.pop()
        },
        /web_matrix_incomplete/,
      ],
      [
        (r) => {
          r.suites[0].specs[0].tests[0].results[0].status = 'skipped'
        },
        /web_matrix_case_failed/,
      ],
      [
        (r) => {
          r.suites[0].specs[0].tests[0].status = 'unexpected'
        },
        /web_matrix_case_failed/,
      ],
      [
        (r) => {
          r.suites[0].suites[0].title = 'unsupported'
        },
        /web_matrix_locale_missing/,
      ],
      [
        (r) => {
          r.suites[0].specs[2].title = 'P-UNREVIEWED '
        },
        /web_matrix_behavior_missing/,
      ],
      [
        (r) => {
          r.suites[0].specs[0].id = '1'
        },
        /web_matrix_incomplete/,
      ],
    ]) {
      const value = report()
      change(value)
      assert.throws(() => assertWebMatrix(value), code)
    }
  })

  test('rejects reporter errors and a case from an extra project beyond the 45', () => {
    const errored = report()
    errored.errors = [{ message: 'global setup failed' }]
    assert.throws(() => assertWebMatrix(errored), /web_matrix_errors/)
    const extra = report()
    extra.suites[0].specs[0].tests.push({
      projectName: 'mobile-chrome',
      expectedStatus: 'passed',
      status: 'expected',
      results: [{ status: 'passed' }],
    })
    assert.throws(() => assertWebMatrix(extra), /web_matrix_unexpected_cases/)
  })
})
