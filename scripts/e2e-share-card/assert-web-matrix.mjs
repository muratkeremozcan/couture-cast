import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
export const SPEC_FILE = 'playwright/tests/share-card-export.spec.ts'
const LOCALE_FILE = 'packages/api-client/src/contracts/http/supported-locales.json'
export const BROWSERS = ['chromium', 'firefox', 'webkit']
/**
 * The validated summary's private runtime file. It sits in the runtime root, outside the
 * uploaded directory; public-evidence.mjs validates it and projects it into that directory.
 */
export const WEB_MATRIX_SUMMARY_FILE = 'web-matrix-summary.json'
// Behaviors every locale must prove exactly once, and the locale-independent ones,
// each proven by at least one distinct shared case (P-OFFLINE has a community and
// an outfit case).
export const LOCALE_BEHAVIORS = [
  'P-POST ',
  'P-WATERMARK:',
  'P-DOWNLOAD-BYTES:',
  'P-A11Y:',
]
export const SHARED_BEHAVIORS = [
  'P-BOOTSTRAP:',
  'P-FOREIGN ',
  'P-REVALIDATE ',
  'P-OUTFIT ',
  'P-OFFLINE:',
  'P-CANCEL P-IDENTITY:',
  'P-CANCEL-SAVE:',
  'P-MODAL-STACK:',
]
/**
 * Story 6.9 Web Share behaviors. Each runs once per browser as a shared case, never per
 * locale, and the lane carries at most SHARE_TITLE_BUDGET share titles so the
 * browser-acceptance job stays inside its time budget.
 */
export const SHARE_BEHAVIORS = [
  'P-SHARE-BYTES:',
  'P-SHARE-DISMISS:',
  'P-SHARE-TAP-AGAIN:',
  'P-SHARE-CAPABILITY-OFF:',
  'P-SHARE-REVALIDATE:',
]
export const SHARE_TITLE_BUDGET = 5
const SHARE_TITLE = 'P-SHARE-'

function assertSpecBehaviors(perLocale, shared) {
  const proofs = (titles, behavior) =>
    titles.filter((name) => name.startsWith(behavior)).length
  for (const behavior of LOCALE_BEHAVIORS)
    if (proofs(perLocale, behavior) !== 1)
      throw new Error(`web_matrix_spec_behavior_missing: ${behavior}`)
  for (const behavior of [...SHARED_BEHAVIORS, ...SHARE_BEHAVIORS])
    if (proofs(shared, behavior) < 1)
      throw new Error(`web_matrix_spec_behavior_missing: ${behavior}`)
  if (proofs(perLocale, SHARE_TITLE) !== 0)
    throw new Error('web_matrix_spec_share_per_locale')
  if (proofs(shared, SHARE_TITLE) > SHARE_TITLE_BUDGET)
    throw new Error('web_matrix_spec_share_budget')
  for (const titles of [perLocale, shared])
    if (new Set(titles).size !== titles.length)
      throw new Error('web_matrix_spec_duplicate_title')
}

/**
 * The case titles the spec declares: tests inside its per-locale describe and
 * top-level tests. The expected matrix comes from the spec itself, so a split or a
 * removed body changes the expectation instead of hiding behind a fixed count.
 */
export function specCases(source) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) =>
    /^for \(const locale of supportedLocales\)$/.test(line)
  )
  if (start === -1 || !/^\s+test\.describe\(locale, /.test(lines[start + 1] ?? ''))
    throw new Error('web_matrix_spec_locale_block_missing')
  if (/\btest\.(skip|fixme|only)\(|\btest\(`/.test(source))
    throw new Error('web_matrix_spec_unsupported_declaration')
  const title = /^(\s*)test\('((?:[^'\\]|\\.)*)'/
  const perLocale = []
  const shared = []
  for (const [index, line] of lines.entries()) {
    const match = title.exec(line)
    if (!match) continue
    if (match[1] === '') shared.push(match[2])
    else if (index > start && match[1] === '    ') perLocale.push(match[2])
    else throw new Error(`web_matrix_spec_unplaced_test: ${match[2]}`)
  }
  assertSpecBehaviors(perLocale, shared)
  return { perLocale, shared }
}

/** The expected matrix from the checked-in spec and the supported locale catalog. */
export function expectedWebMatrix({ root = repository } = {}) {
  const cases = specCases(fs.readFileSync(path.join(root, SPEC_FILE), 'utf8'))
  const locales = Object.keys(
    JSON.parse(fs.readFileSync(path.join(root, LOCALE_FILE), 'utf8'))
  )
  return { ...cases, locales }
}

const passed = (test) =>
  test.expectedStatus === 'passed' &&
  test.status === 'expected' &&
  test.results?.at(-1)?.status === 'passed'

export function assertWebMatrix(report, expected = expectedWebMatrix()) {
  if (report.errors?.length) throw new Error('web_matrix_errors')
  const { perLocale, shared, locales } = expected
  const perBrowser = perLocale.length * locales.length + shared.length
  const cases = []
  function visit(suite, parents = []) {
    const titles = [...parents, suite.title]
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) cases.push({ spec, test, titles })
    for (const child of suite.suites ?? []) visit(child, titles)
  }
  for (const suite of report.suites ?? []) visit(suite)
  const summary = []
  for (const browser of BROWSERS) {
    const rows = cases.filter(({ test }) => test.projectName === browser)
    if (
      rows.length !== perBrowser ||
      new Set(rows.map(({ spec }) => spec.id)).size !== perBrowser
    )
      throw new Error('web_matrix_incomplete')
    for (const { test } of rows)
      if (!passed(test)) throw new Error('web_matrix_case_failed')
    const count = (title, locale) =>
      rows.filter(
        ({ spec, titles }) =>
          spec.title === title &&
          (locale === undefined
            ? !titles.some((name) => locales.includes(name))
            : titles.includes(locale))
      ).length
    for (const locale of locales)
      for (const title of perLocale)
        if (count(title, locale) !== 1) throw new Error('web_matrix_locale_missing')
    for (const title of shared)
      if (count(title) !== 1) throw new Error('web_matrix_behavior_missing')
    summary.push({ browser, passed: rows.length, locales: [...locales] })
  }
  if (cases.length !== perBrowser * BROWSERS.length)
    throw new Error('web_matrix_unexpected_cases')
  return { passed: true, cases: cases.length, projects: summary }
}

/**
 * Re-validates a summary read back from its private file against the expected matrix and
 * returns a fresh object built only from the closed fields, so nothing else in the file
 * can reach the uploaded directory.
 */
export function assertWebMatrixSummary(value, expected = expectedWebMatrix()) {
  const closed = (object, keys) =>
    object !== null &&
    typeof object === 'object' &&
    !Array.isArray(object) &&
    Object.keys(object).sort().join() === keys.slice().sort().join()
  const perBrowser =
    expected.perLocale.length * expected.locales.length + expected.shared.length
  if (
    !closed(value, ['passed', 'cases', 'projects']) ||
    value.passed !== true ||
    value.cases !== perBrowser * BROWSERS.length ||
    !Array.isArray(value.projects) ||
    value.projects.length !== BROWSERS.length
  )
    throw new Error('web_matrix_summary_invalid')
  const projects = value.projects.map((project, index) => {
    if (
      !closed(project, ['browser', 'passed', 'locales']) ||
      project.browser !== BROWSERS[index] ||
      project.passed !== perBrowser ||
      JSON.stringify(project.locales) !== JSON.stringify(expected.locales)
    )
      throw new Error('web_matrix_summary_invalid')
    return {
      browser: project.browser,
      passed: project.passed,
      locales: [...expected.locales],
    }
  })
  return { passed: true, cases: value.cases, projects }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  const summaryFile = path.join(directory, WEB_MATRIX_SUMMARY_FILE)
  // A summary left by an earlier run must never stand in for this one.
  fs.rmSync(summaryFile, { force: true })
  const summary = assertWebMatrix(
    JSON.parse(
      fs.readFileSync(path.join(directory, 'playwright-web-matrix.json'), 'utf8')
    )
  )
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
  console.log(
    `All ${summary.cases} durable web cases passed across Chromium, Firefox and WebKit.`
  )
}
