export const shareCardAuditLocales = [
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
export const shareCardAuditStates = [
  'open',
  'unavailable',
  'saved',
  'storage-failure',
  'offline',
  'denied',
  'permanent-denied',
  'limited',
  'pending',
  'preparing',
]
export const shareCardAuditTestIDs = [
  'testAllLocalesAndWatermarkOFFFullLabels',
  'testOpenSaveCancelAndFailureTraversal',
  'testUnavailableAndOfflineTraversal',
  'testDeniedPermanentLimitedAndPendingTraversal',
  'testPreparingCancelAndRetryTraversal',
  'testRasterOCRExceptionRejectsEveryNearMiss',
  'testTextOCRExceptionRejectsEveryNearMiss',
  'testRasterExceptionsRequirePresentExactlyLabelledPreview',
].map((name) => `ShareCardAccessibilityUITests/${name}()`)
const knownIssues = new Set([
  'Potentially inaccessible element',
  'Potentially inaccessible text',
  'Element has no description',
])
function observedAuditStates(log) {
  const observedStates = []
  for (const match of log.matchAll(
    /CC68_STATE_PASS ([A-Za-z0-9-]+) ([a-z-]+) (on|off|none)(?=\s|$)/g
  ))
    if (
      shareCardAuditLocales.includes(match[1]) &&
      shareCardAuditStates.includes(match[2])
    )
      observedStates.push({
        locale: match[1],
        state: match[2],
        watermark: match[3],
        fullLabelAndImageTrait: match[3] !== 'none',
        ownLocalizedStatusElement: match[2] !== 'open',
        traversalAndIntendedFocusTarget: true,
      })
  return observedStates
}
function observedAuditIssues(log) {
  const issues = []
  for (const match of log.matchAll(
    /CC68_AUDIT_CLOSED ([a-z-]+)\|(\d+)\|(true|false)\|([^\r\n]+)/g
  ))
    if (shareCardAuditStates.includes(match[1]))
      issues.push({
        state: match[1],
        type: Number(match[2]),
        hasElement: match[3] === 'true',
        compact: knownIssues.has(match[4]) ? match[4] : 'unclassified_audit_issue',
      })
  return issues
}
export function closedShareCardAuditReport(summary, tree, log) {
  const tests = []
  const walk = (node) => {
    if (
      node.nodeType === 'Test Case' &&
      shareCardAuditTestIDs.includes(node.nodeIdentifier)
    )
      tests.push({
        id: node.nodeIdentifier,
        result: ['Passed', 'Failed', 'Skipped'].includes(node.result)
          ? node.result
          : 'Unknown',
      })
    for (const child of node.children ?? []) walk(child)
  }
  for (const node of tree.testNodes ?? []) walk(node)
  const observedStates = observedAuditStates(log)
  const issues = observedAuditIssues(log)
  const missingTests = shareCardAuditTestIDs.filter(
    (id) => !tests.some((test) => test.id === id && test.result === 'Passed')
  )
  const missingStates = shareCardAuditStates.filter(
    (state) =>
      !observedStates.some(
        (row) =>
          row.state === state &&
          (state === 'preparing' ? row.watermark === 'none' : row.fullLabelAndImageTrait)
      )
  )
  const missingLocaleWatermarks = shareCardAuditLocales.flatMap((locale) =>
    ['on', 'off']
      .filter(
        (watermark) =>
          !observedStates.some(
            (row) =>
              row.locale === locale && row.state === 'open' && row.watermark === watermark
          )
      )
      .map((watermark) => `${locale}:${watermark}`)
  )
  return {
    platform: 'ios',
    method: 'XCUITest simulator substitute',
    auditTypes: 'all',
    passed:
      summary.result === 'Passed' &&
      summary.totalTestCount === shareCardAuditTestIDs.length &&
      summary.passedTests === shareCardAuditTestIDs.length &&
      tests.length === shareCardAuditTestIDs.length &&
      missingTests.length === 0 &&
      missingStates.length === 0 &&
      missingLocaleWatermarks.length === 0,
    counts: {
      total: Number(summary.totalTestCount ?? 0),
      passed: Number(summary.passedTests ?? 0),
      failed: Number(summary.failedTests ?? 0),
      skipped: Number(summary.skippedTests ?? 0),
    },
    tests,
    failedTestIDs: tests
      .filter((test) => test.result !== 'Passed')
      .map((test) => test.id),
    missingTests,
    missingStates,
    missingLocaleWatermarks,
    states: observedStates,
    strictIssues: issues,
    focusEvidence:
      'intended AX targets plus native focus bridge call tests; physical VoiceOver cursor unavailable',
    announcementEvidence:
      'own localized AX status plus exact RN posted announcement bridge tests; physical VoiceOver delivery unavailable',
  }
}
