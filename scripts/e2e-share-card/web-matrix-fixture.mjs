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
  // One file suite per spec, as Playwright reports them; Web Share cases sit in their own.
  const isShare = (spec) => spec.title.startsWith('P-SHARE-')
  return {
    suites: [
      {
        title: 'share-card-export.spec.ts',
        specs: specs.filter((spec) => !isShare(spec)),
        suites,
      },
      { title: 'share-card-native-share.spec.ts', specs: specs.filter(isShare) },
    ],
    errors: [],
  }
}
