import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const browsers = ['chromium', 'firefox', 'webkit']
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
const passed = (test) =>
  test.expectedStatus === 'passed' &&
  test.status === 'expected' &&
  test.results?.at(-1)?.status === 'passed'
export function assertWebMatrix(report) {
  if (report.errors?.length) throw new Error('web_matrix_errors')
  const cases = []
  function visit(suite, parents = []) {
    const titles = [...parents, suite.title]
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) cases.push({ spec, test, titles })
    for (const child of suite.suites ?? []) visit(child, titles)
  }
  for (const suite of report.suites ?? []) visit(suite)
  const summary = []
  for (const browser of browsers) {
    const rows = cases.filter(({ test }) => test.projectName === browser)
    if (rows.length !== 15 || new Set(rows.map(({ spec }) => spec.id)).size !== 15)
      throw new Error('web_matrix_incomplete')
    for (const { test } of rows)
      if (!passed(test)) throw new Error('web_matrix_case_failed')
    for (const locale of locales)
      if (
        rows.filter(
          ({ titles, spec }) =>
            titles.includes(locale) && spec.title.startsWith('P-POST ')
        ).length !== 1
      )
        throw new Error('web_matrix_locale_missing')
    for (const prefix of [
      'P-FOREIGN ',
      'P-REVALIDATE ',
      'P-OUTFIT ',
      'P-CANCEL P-IDENTITY:',
      'P-CANCEL-SAVE:',
    ])
      if (rows.filter(({ spec }) => spec.title.startsWith(prefix)).length !== 1)
        throw new Error('web_matrix_behavior_missing')
    summary.push({ browser, passed: rows.length, locales: [...locales] })
  }
  if (cases.length !== 45) throw new Error('web_matrix_unexpected_cases')
  return { passed: true, cases: 45, projects: summary }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  const summary = assertWebMatrix(
    JSON.parse(
      fs.readFileSync(path.join(directory, 'playwright-web-matrix.json'), 'utf8')
    )
  )
  fs.mkdirSync(path.join(directory, 'public-evidence'), { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'public-evidence', 'web-matrix.json'),
    JSON.stringify(summary, null, 2) + '\n'
  )
  console.log('All45 durable web cases passed across Chromium, Firefox and WebKit.')
}
