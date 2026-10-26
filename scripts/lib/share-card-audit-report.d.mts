export const shareCardAuditLocales: string[]
export const shareCardAuditStates: string[]
export const shareCardAuditTestIDs: string[]
export const shareCardNativeBehaviors: string[]
export function closedShareCardAuditReport(
  summary: {
    result?: string
    totalTestCount?: number
    passedTests?: number
    failedTests?: number
    skippedTests?: number
  },
  tree: { testNodes?: unknown[] },
  log: string
): {
  passed: boolean
  counts: { total: number; passed: number; failed: number; skipped: number }
  failedTestIDs: string[]
  nativeBehaviors: string[]
  missingNativeBehaviors: string[]
  strictIssues: { compact: string }[]
  states: { state: string }[]
}
