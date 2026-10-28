import { BROWSERS } from './assert-web-matrix.mjs'

/** A passing Playwright JSON report for exactly the expected matrix. */
export function passingReport(expected) {
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
