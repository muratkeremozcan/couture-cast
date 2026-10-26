import { test } from 'node:test'
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
test('accepts exactly15 actual passed behaviors per engine and emits only closed summary', () => {
  assert.equal(assertWebMatrix(report()).cases, 45)
})
test('rejects missing engines, skipped or failed cases, missing locale and duplicate case', () => {
  for (const change of [
    (r) => {
      r.suites[0].specs[0].tests.pop()
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = 'skipped'
    },
    (r) => {
      r.suites[0].specs[0].tests[0].status = 'unexpected'
    },
    (r) => {
      r.suites[0].suites[0].title = 'unsupported'
    },
    (r) => {
      r.suites[0].specs[0].id = '1'
    },
  ]) {
    const value = report()
    change(value)
    assert.throws(() => assertWebMatrix(value))
  }
})
