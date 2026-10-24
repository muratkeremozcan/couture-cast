/**
 * Type declarations for `check-accessibility-focus-results.mjs`, so its unit tests
 * under `playwright/` can import it plainly (see `local-e2e-database.d.mts`).
 */

export declare const EXPECTED_TESTS: string[]

export declare const NEED_OS_REPORT: string[]

export type TestCaseOutcome = {
  name: string
  outcome: 'passed' | 'failure' | 'error' | 'skipped'
  text: string
}

export declare function readRun(directory: string): {
  files: number
  cases: TestCaseOutcome[]
}

export declare function checkResults(
  results: string,
  positiveStatus: number,
  suppressedStatus: number
): string[]
