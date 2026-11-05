// Story 6.12 test owner: U-GF-METRICS and U-RB-RUNBOOK. What the dashboard and the runbook claim
// is checked against the code and against what this story can honestly state.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8')

const telemetry = read('apps/api/src/modules/moderation/moderation-sla.telemetry.ts')
const exported = [
  ...(/MODERATION_SLA_METRIC_NAMES = \[([\s\S]*?)\]/.exec(telemetry)?.[1] ?? '').matchAll(
    /'([^']+)'/g
  ),
].map((match) => match[1] as string)

describe('U-GF-METRICS: couturecast-moderation-sla.json', () => {
  const raw = read('infra/grafana/dashboards/couturecast-moderation-sla.json')
  const dashboard = JSON.parse(raw) as { panels?: { targets?: { expr?: string }[] }[] }
  const expressions = (dashboard.panels ?? []).flatMap((panel) =>
    (panel.targets ?? []).map((target) => target.expr ?? '')
  )
  const named = new Set(
    expressions.flatMap((expr) => expr.match(/moderation_sla_[a-z_]+/g) ?? [])
  )

  it('reads four metric names from the code', () => {
    expect(exported.length).toBe(4)
  })

  it('names only metrics the code exports', () => {
    expect(named.size).toBeGreaterThan(0)
    for (const name of named) expect(exported).toContain(name)
  })

  it('gives every exported metric a panel', () => {
    for (const name of exported) expect([...named]).toContain(name)
  })

  it('groups by closed labels only, with no case or member label', () => {
    for (const expr of expressions) {
      const labels = expr.replace(/moderation_sla_[a-z_]+/g, '')
      expect(labels).not.toMatch(/case|member|user|reporter|subject|alert_id/i)
      for (const match of expr.matchAll(/by \(([^)]*)\)/g))
        for (const label of (match[1] ?? '').split(',').map((item) => item.trim()))
          expect(['state', 'kind', 'code']).toContain(label)
    }
  })

  it('adds no alert rule or notification policy, per the 0.7 no-notification policy', () => {
    expect(raw).not.toMatch(/"alert"\s*:|notificationPolicy|contactPoint/i)
  })

  it('is listed in the dashboards README', () => {
    expect(read('infra/grafana/dashboards/README.md')).toMatch(
      /couturecast-moderation-sla\.json/
    )
  })
})

describe('U-RB-RUNBOOK: moderation-sla-runbook.md', () => {
  const runbook = read('_bmad-output/project-knowledge/moderation-sla-runbook.md')

  for (const heading of [
    '### Community moderator',
    '### Admin',
    '### On-duty responder',
    '### Release owner',
    '### at_risk',
    '### breached',
    '### escalated',
    '## Stale monitor',
    '## Failing channel',
    '## Webhook setup',
    '## Drill',
    '## Rollout',
    '## Rollback',
  ]) {
    it(`has ${heading}`, () => {
      expect(runbook).toContain(`\n${heading}\n`)
    })
  }

  it('leaves every coverage assignee blank', () => {
    const rows = runbook
      .slice(runbook.indexOf('## Coverage'))
      .split('\n')
      .filter((line) =>
        /^\| (Community moderator|Admin|On-duty responder|Release owner)/.test(line)
      )
    expect(rows.length).toBe(4)
    for (const row of rows) {
      const cells = row.split('|').map((cell) => cell.trim())
      expect(cells[2]).toBe('')
      expect(cells[3]).toBe('')
    }
  })

  it('names no person: no email address and no at-handle', () => {
    expect(runbook).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
    expect(runbook).not.toMatch(/(^|\s)@[a-z][\w-]+/im)
  })

  it('states the staffing signature as open (D16)', () => {
    expect(runbook).toMatch(/D16/)
    expect(runbook).toMatch(/not proved/)
  })

  it('states that nobody is notified until a webhook is set (D8)', () => {
    expect(runbook).toMatch(/nobody is notified/)
  })

  it('names the system subject in the rollout (TEA-06)', () => {
    expect(runbook.slice(runbook.indexOf('## Rollout'))).toContain(
      'system:moderation-sla'
    )
  })

  it('gives the JobFailure removal SQL and warns against retry (TEA-16)', () => {
    expect(runbook).toMatch(
      /DELETE FROM "JobFailure" WHERE job_id = 'moderation_sla_delivery__/
    )
    expect(runbook).toMatch(/Do not use the admin `failed-jobs\/retry` route/)
  })

  it('lists APP_URL beside the webhook setup (TEA-12)', () => {
    const setup = runbook.slice(
      runbook.indexOf('## Webhook setup'),
      runbook.indexOf('## Drill')
    )
    expect(setup).toMatch(/APP_URL/)
    expect(setup).toMatch(/MODERATION_OPS_WEBHOOK_URL/)
  })
})
