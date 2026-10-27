import { describe, expect, it } from 'vitest'
import {
  closedShareCardAuditReport,
  shareCardAuditTestIDs,
  shareCardAuditLocales,
  shareCardAuditStates,
} from '../../../scripts/lib/share-card-audit-report.mjs'
const summary = {
  result: 'Passed',
  totalTestCount: shareCardAuditTestIDs.length,
  passedTests: shareCardAuditTestIDs.length,
}
const nodes = shareCardAuditTestIDs.map((id) => ({
  nodeType: 'Test Case',
  nodeIdentifier: id,
  result: 'Passed',
}))
const markers = [
  ...shareCardAuditLocales.flatMap((locale) =>
    ['on', 'off'].map((watermark) => `CC68_STATE_PASS ${locale} open ${watermark}`)
  ),
  ...shareCardAuditStates
    .filter((state) => state !== 'open')
    .map(
      (state) => `CC68_STATE_PASS en-US ${state} ${state === 'preparing' ? 'none' : 'on'}`
    ),
]
const behaviorMarkers = [
  'CC68_NATIVE_BEHAVIOR_PASS owned-saving',
  'CC68_NATIVE_BEHAVIOR_PASS reopened-finishing',
  'CC68_NATIVE_BEHAVIOR_PASS watermark-reenabled',
  'CC68_NATIVE_BEHAVIOR_PASS existing-header-labels',
]
const report = (tests = nodes, log = [...markers, ...behaviorMarkers].join('\n')) =>
  closedShareCardAuditReport(summary, { testNodes: tests }, log)
describe('closedShareCardAuditReport', () => {
  it('requires every named behavior, state, and supported locale ON and OFF before declaring the all-audit complete', () => {
    expect(report().passed).toBe(true)
    for (const node of nodes)
      expect(report(nodes.filter((n) => n !== node)).passed).toBe(false)
    for (const marker of markers)
      expect(
        report(
          nodes,
          [...markers.filter((m) => m !== marker), ...behaviorMarkers].join('\n')
        ).passed
      ).toBe(false)
    expect(
      closedShareCardAuditReport({ result: 'Passed', totalTestCount: 0 }, {}, '').passed
    ).toBe(false)
    expect(
      closedShareCardAuditReport(
        { result: 'Passed', totalTestCount: 1, passedTests: 1 },
        { testNodes: [nodes[0]] },
        ''
      ).passed
    ).toBe(false)
    expect(report([...nodes, nodes[0]!]).passed).toBe(false)
    expect(
      report(nodes.map((n, i) => (i === 0 ? { ...n, result: 'Skipped' } : n))).passed
    ).toBe(false)
    expect(
      report(
        nodes,
        [...markers, ...behaviorMarkers]
          .join('\n')
          .replace('en-US preparing none', 'en-US preparing on')
      ).passed
    ).toBe(false)
  })
  it('exports closed results and allowlisted locales, excluding raw failures, unknown test IDs, and untrusted descriptions', () => {
    const output = report(
      [
        {
          ...nodes[0]!,
          result: 'Failed',
          failureText: 'PRIVATE_TOKEN@example.test',
        } as (typeof nodes)[number],
        {
          nodeType: 'Test Case',
          nodeIdentifier: 'ShareCardAccessibilityUITests/testPRIVATE_TOKEN()',
          result: 'Failed',
        },
      ],
      'CC68_STATE_PASS es-419 open on\nCC68_STATE_PASS PRIVATE_TOKEN open on\nCC68_AUDIT_CLOSED saved|2|false|PRIVATE_TOKEN@example.test\nCC68_AUDIT_CLOSED saved|2|false|Potentially inaccessible text'
    )
    expect(output.passed).toBe(false)
    expect(output.failedTestIDs).toEqual([nodes[0]!.nodeIdentifier])
    expect(output.states).toEqual([expect.objectContaining({ locale: 'es-419' })])
    expect(output.strictIssues.map((issue) => issue.compact)).toEqual([
      'unclassified_audit_issue',
      'Potentially inaccessible text',
    ])
    expect(JSON.stringify(output)).not.toContain('PRIVATE_TOKEN')
  })

  it('requires current-owned Saving, reopened Finishing, watermark recovery and existing header proof', () => {
    expect(report().passed).toBe(true)
    for (const marker of behaviorMarkers) {
      const incomplete = [
        ...markers,
        ...behaviorMarkers.filter((value) => value !== marker),
      ].join('\n')
      expect(report(nodes, incomplete).passed).toBe(false)
    }
  })

  it('describes actual posted UIKit targets and header traits with the approved simulator limitation', () => {
    expect(report().focusEvidence).toBe(
      'posted UIKit layoutChanged requests, attached targets, actual header traits and AX traversal; approved simulator substitute; physical VoiceOver cursor unavailable'
    )
  })
})
