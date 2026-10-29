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
  'testOwnedSavingAndReopenedFinishingRestoreWatermark',
  'testRasterOCRExceptionRejectsEveryNearMiss',
  'testTextOCRExceptionRejectsEveryNearMiss',
  'testRasterExceptionsRequirePresentExactlyLabelledPreview',
].map((name) => `ShareCardAccessibilityUITests/${name}()`)
export const shareCardNativeBehaviors = [
  'owned-saving',
  'reopened-finishing',
  'watermark-reenabled',
  'existing-header-labels',
]
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
const failureContextLines = 8
const failureLineChars = 300
const failureDigestLimit = 24
const failedIssueLimit = 40
// The xcodebuild log is private. A failed XCUITest is only explained by the steps
// right before its first assertion, so the job log carries that window.
export function failedAuditTestDigest(log) {
  const lines = log.split(/\r?\n/)
  const digests = []
  for (let end = 0; end < lines.length; end += 1) {
    const failed = lines[end].match(/^Test Case '-\[\S+ (test\w+)\]' failed/)
    if (!failed) continue
    let start = end - 1
    while (start > 0 && !/^Test Case '.*' started\./.test(lines[start])) start -= 1
    const section = lines.slice(start + 1, end)
    const assertion = section.findIndex((line) => /\.swift:\d+: error: /.test(line))
    const window =
      assertion < 0
        ? section.slice(-failureContextLines)
        : section.slice(
            Math.max(0, assertion - failureContextLines),
            assertion + 1 + failureContextLines
          )
    digests.push({
      test: failed[1],
      lines: window
        .filter((line) => line.trim())
        .map((line) =>
          line
            .replace(/\S*\/(?=[^/\s]+\.swift)/g, '')
            .trim()
            .slice(0, failureLineChars)
        )
        .slice(0, failureDigestLimit),
    })
  }
  return digests
}
// Each issue the Swift audit handler refused, in log order.
export function failedAuditIssues(log) {
  return [...log.matchAll(/^CC68_AUDIT_ISSUE ([^\r\n]+)/gm)]
    .map((match) => match[1].replace(/\S*\/(?=[^/\s]+\.swift)/g, '').slice(0, 400))
    .slice(0, failedIssueLimit)
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
  const nativeBehaviors = [
    ...new Set(
      [...log.matchAll(/CC68_NATIVE_BEHAVIOR_PASS ([a-z-]+)(?=\s|$)/g)]
        .map((match) => match[1])
        .filter((name) => shareCardNativeBehaviors.includes(name))
    ),
  ]
  const missingNativeBehaviors = shareCardNativeBehaviors.filter(
    (name) => !nativeBehaviors.includes(name)
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
      missingLocaleWatermarks.length === 0 &&
      missingNativeBehaviors.length === 0,
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
    nativeBehaviors,
    missingNativeBehaviors,
    states: observedStates,
    strictIssues: issues,
    focusEvidence:
      'posted UIKit layoutChanged requests, attached targets, actual header traits and AX traversal; approved simulator substitute; physical VoiceOver cursor unavailable',
    announcementEvidence:
      'own localized AX status plus exact RN posted announcement bridge tests; physical VoiceOver delivery unavailable',
  }
}
