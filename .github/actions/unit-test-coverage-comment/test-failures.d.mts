/**
 * Type declarations for `test-failures.mjs`, so its unit tests under `playwright/`
 * can import it plainly (see `scripts/ci/check-accessibility-focus-results.d.mts`).
 */

export type FailureReason = 'tests' | 'coverage' | 'error'

export type WorkspaceFailure = {
  workspace: string
  reason: FailureReason
  line?: string
}

export function classifyWorkspaceOutput(output: string): {
  reason: FailureReason
  line: string
}

export function parseFailures(raw: string | undefined): WorkspaceFailure[]

export function verdict(input: {
  testOutcome: string
  diffThresholdFailed: boolean
  failures: WorkspaceFailure[]
}): { label: 'SUCCESS' | 'FAILURE' | 'TESTS FAILED'; lead: string }

export function failureLines(
  lead: string,
  failures: WorkspaceFailure[],
  jobUrl: string | undefined
): string[]

export function summaryLines(env?: NodeJS.ProcessEnv): string[]
