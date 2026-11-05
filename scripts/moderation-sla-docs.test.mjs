// Story 6.12 test owner: U-GF-METRICS and U-RB-RUNBOOK. What the dashboard and the runbook claim
// is checked against the code and against what this story can honestly state.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8')

const telemetry = read('apps/api/src/modules/moderation/moderation-sla.telemetry.ts')
const exported = [
  ...(/MODERATION_SLA_METRIC_NAMES = \[([\s\S]*?)\]/.exec(telemetry)?.[1] ?? '').matchAll(
    /'([^']+)'/g
  ),
].map((match) => match[1])

describe('U-GF-METRICS: couturecast-moderation-sla.json', () => {
  const raw = read('infra/grafana/dashboards/couturecast-moderation-sla.json')
  const dashboard = JSON.parse(raw)
  const expressions = (dashboard.panels ?? []).flatMap((panel) =>
    (panel.targets ?? []).map((target) => target.expr ?? '')
  )
  const named = new Set(
    expressions.flatMap((expr) => expr.match(/moderation_sla_[a-z_]+/g) ?? [])
  )

  it('reads four metric names from the code', () => {
    assert.equal(exported.length, 4, exported.join(','))
  })

  it('names only metrics the code exports', () => {
    assert.ok(named.size > 0)
    for (const name of named)
      assert.ok(exported.includes(name), `invented metric ${name}`)
  })

  it('gives every exported metric a panel', () => {
    for (const name of exported) assert.ok(named.has(name), `no panel for ${name}`)
  })

  it('groups by closed labels only, with no case or member label', () => {
    for (const expr of expressions) {
      const labels = expr.replace(/moderation_sla_[a-z_]+/g, '')
      assert.doesNotMatch(labels, /case|member|user|reporter|subject|alert_id/i, expr)
      for (const match of expr.matchAll(/by \(([^)]*)\)/g))
        for (const label of match[1].split(',').map((item) => item.trim()))
          assert.ok(['state', 'kind', 'code'].includes(label), `open label ${label}`)
    }
  })

  it('adds no alert rule or notification policy, per the 0.7 no-notification policy', () => {
    assert.doesNotMatch(raw, /"alert"\s*:|notificationPolicy|contactPoint/i)
  })

  it('is listed in the dashboards README', () => {
    assert.match(
      read('infra/grafana/dashboards/README.md'),
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
      assert.ok(runbook.includes(`\n${heading}\n`), heading)
    })
  }

  it('leaves every coverage assignee blank', () => {
    const rows = runbook
      .slice(runbook.indexOf('## Coverage'))
      .split('\n')
      .filter((line) =>
        /^\| (Community moderator|Admin|On-duty responder|Release owner)/.test(line)
      )
    assert.equal(rows.length, 4)
    for (const row of rows) {
      const cells = row.split('|').map((cell) => cell.trim())
      assert.equal(cells[2], '', row)
      assert.equal(cells[3], '', row)
    }
  })

  it('names no person: no email address and no at-handle', () => {
    assert.doesNotMatch(runbook, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
    assert.doesNotMatch(runbook, /(^|\s)@[a-z][\w-]+/im)
  })

  it('states the staffing signature as open (D16)', () => {
    assert.match(runbook, /D16/)
    assert.match(runbook, /not proved/)
  })

  it('states that nobody is notified until a webhook is set (D8)', () => {
    assert.match(runbook, /nobody is notified/)
  })

  it('names the system subject in the rollout (TEA-06)', () => {
    assert.ok(
      runbook.slice(runbook.indexOf('## Rollout')).includes('system:moderation-sla')
    )
  })

  it('gives the JobFailure removal SQL and warns against retry (TEA-16)', () => {
    assert.match(
      runbook,
      /DELETE FROM "JobFailure" WHERE job_id = 'moderation_sla_delivery__/
    )
    assert.match(runbook, /Do not use the admin `failed-jobs\/retry` route/)
  })

  it('lists APP_URL beside the webhook setup (TEA-12)', () => {
    const setup = runbook.slice(
      runbook.indexOf('## Webhook setup'),
      runbook.indexOf('## Drill')
    )
    assert.match(setup, /APP_URL/)
    assert.match(setup, /MODERATION_OPS_WEBHOOK_URL/)
  })
})
