import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BROWSERS,
  LOCALE_BEHAVIORS,
  SHARED_BEHAVIORS,
  SPEC_FILE,
  assertWebMatrix,
  expectedWebMatrix,
  specCases,
} from './assert-web-matrix.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const spec = fs.readFileSync(path.join(root, SPEC_FILE), 'utf8')
const expected = expectedWebMatrix()

/** A passing Playwright JSON report for exactly the expected matrix. */
function report() {
  const pass = () =>
    BROWSERS.map((projectName) => ({
      projectName,
      expectedStatus: 'passed',
      status: 'expected',
      results: [{ status: 'passed' }],
    }))
  const suites = expected.locales.map((locale) => ({
    title: locale,
    specs: expected.perLocale.map((title, index) => ({
      id: `${locale}-${index}`,
      title,
      tests: pass(),
    })),
  }))
  const specs = expected.shared.map((title, index) => ({
    id: `shared-${index}`,
    title,
    tests: pass(),
  }))
  return { suites: [{ title: 'share-card-export.spec.ts', specs, suites }], errors: [] }
}
const locale = (value, name) => value.suites[0].suites.find((row) => row.title === name)

describe('expected web matrix from the spec', () => {
  test('every locale proves each locale behavior once and the shared behaviors run once', () => {
    assert.deepEqual(
      expected.perLocale.map((title) =>
        LOCALE_BEHAVIORS.find((p) => title.startsWith(p))
      ),
      LOCALE_BEHAVIORS
    )
    assert.deepEqual(
      SHARED_BEHAVIORS.filter((p) =>
        expected.shared.some((title) => title.startsWith(p))
      ),
      SHARED_BEHAVIORS
    )
    // Each shared behavior's case count, so losing one of several cases fails here.
    assert.deepEqual(
      SHARED_BEHAVIORS.map(
        (p) => expected.shared.filter((title) => title.startsWith(p)).length
      ),
      [1, 1, 1, 2, 1, 1]
    )
    assert.equal(expected.shared.length, 7)
    // The 2026-10 split: 4 cases in each of 10 locales plus 7 shared, per browser.
    const perBrowser =
      expected.perLocale.length * expected.locales.length + expected.shared.length
    assert.deepEqual([expected.locales.length, perBrowser, perBrowser * 3], [10, 47, 141])
  })

  test('the expectation follows the spec, so a split body adds a required case', () => {
    const split = spec.replace(
      "    test('P-A11Y:",
      "    test('P-A11Y-SPLIT: a separated half', async () => {})\n    test('P-A11Y:"
    )
    assert.equal(specCases(split).perLocale.length, expected.perLocale.length + 1)
  })

  test('a spec without a required behavior, with a duplicate or a skipped case is refused', () => {
    const offline = spec
      .split('\n')
      .filter((line) => !line.startsWith("test('P-OFFLINE:"))
      .join('\n')
    assert.throws(
      () => specCases(offline),
      /web_matrix_spec_behavior_missing: P-OFFLINE:/
    )
    assert.throws(
      () =>
        specCases(
          spec.replace("    test('P-WATERMARK:", "    test('P-DOWNLOAD-BYTES: copy")
        ),
      /web_matrix_spec_behavior_missing: P-(WATERMARK|DOWNLOAD-BYTES):/
    )
    assert.throws(
      () => specCases(`${spec}\ntest('${expected.shared[1]}', async () => {})\n`),
      /web_matrix_spec_duplicate_title/
    )
    const [community] = expected.shared.filter((title) => title.startsWith('P-OFFLINE:'))
    assert.throws(
      () => specCases(`${spec}\ntest('${community}', async () => {})\n`),
      /web_matrix_spec_duplicate_title/
    )
    assert.throws(
      () => specCases(spec.replace("test('P-OFFLINE:", "test.skip('P-OFFLINE:")),
      /web_matrix_spec_unsupported_declaration/
    )
    assert.throws(
      () => specCases(spec.replace('for (const locale of supportedLocales)', '')),
      /web_matrix_spec_locale_block_missing/
    )
  })
})

describe('assertWebMatrix', () => {
  test('accepts the full passed matrix and emits only the closed summary', () => {
    assert.deepEqual(assertWebMatrix(report(), expected), {
      passed: true,
      cases: 141,
      projects: BROWSERS.map((browser) => ({
        browser,
        passed: 47,
        locales: expected.locales,
      })),
    })
  })

  test('rejects a missing locale case, a duplicate, an absent P-OFFLINE case and failed runs', () => {
    const offline = expected.shared.findIndex((title) => title.startsWith('P-OFFLINE:'))
    for (const [change, code] of [
      [
        (r) => {
          locale(r, 'fr-CA').specs.pop()
        },
        /web_matrix_incomplete/,
      ],
      [
        (r) => {
          const row = locale(r, 'de-DE').specs[1]
          locale(r, 'de-DE').specs.push({ ...row, id: 'de-DE-duplicate' })
        },
        /web_matrix_incomplete/,
      ],
      [
        (r) => {
          r.suites[0].specs.splice(offline, 1)
        },
        /web_matrix_incomplete/,
      ],
      [
        (r) => {
          const [moved] = r.suites[0].specs.splice(offline, 1)
          locale(r, 'tr-TR').specs.push({ ...moved, id: 'tr-TR-moved' })
        },
        /web_matrix_behavior_missing/,
      ],
      [
        (r) => {
          const outfit = r.suites[0].specs.findLastIndex((row) =>
            row.title.startsWith('P-OFFLINE:')
          )
          r.suites[0].specs[outfit].title = r.suites[0].specs[offline].title
        },
        /web_matrix_behavior_missing/,
      ],
      [
        (r) => {
          r.suites[0].specs[offline].title = 'P-OFFLINE-RENAMED: drifted'
        },
        /web_matrix_behavior_missing/,
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
    ]) {
      const value = report()
      change(value)
      assert.throws(() => assertWebMatrix(value, expected), code)
    }
  })

  test('rejects reporter errors and a case from an extra project', () => {
    const errored = report()
    errored.errors = [{ message: 'global setup failed' }]
    assert.throws(() => assertWebMatrix(errored, expected), /web_matrix_errors/)
    const extra = report()
    extra.suites[0].specs[0].tests.push({
      projectName: 'mobile-chrome',
      expectedStatus: 'passed',
      status: 'expected',
      results: [{ status: 'passed' }],
    })
    assert.throws(() => assertWebMatrix(extra, expected), /web_matrix_unexpected_cases/)
  })
})
