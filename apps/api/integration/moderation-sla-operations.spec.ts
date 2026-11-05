// Story 6.12 test owner: I-W-DRILL, U-GF-METRICS and U-RB-RUNBOOK, the operating surface of the monitor.
// The drill is the real script through the real adapter against a real socket.
// DATABASE_URL points nowhere on every run, so a drill that touched a table would fail here.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })

const repoRoot = path.resolve(__dirname, '../../..')
const SCRIPT = 'scripts/moderation-sla-drill.mjs'

async function runDrill(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/none',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  const [code] = (await once(child, 'close')) as [number | null]
  return { code, output }
}

type Received = { headers: IncomingHttpHeaders; body: Record<string, unknown> }

async function withServer(
  status: number,
  run: (url: string, received: Received[]) => Promise<void>
) {
  const received: Received[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      received.push({
        headers: request.headers,
        body: JSON.parse(body) as Record<string, unknown>,
      })
      response.writeHead(status).end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}/CANARYSECRET`, received)
  } finally {
    server.close()
  }
}

describe('I-W-DRILL', () => {
  it('--local posts one payload to a loopback server and exits 0', async () => {
    const { code, output } = await runDrill(['--local'], {})
    expect(code, output).toBe(0)
    expect(output).toMatch(/target=local result=delivered/)
  })

  it('delivers one drill payload naming no case, with the id as the idempotency key', async () => {
    await withServer(204, async (url, received) => {
      const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: url })
      expect(code, output).toBe(0)
      expect(received).toHaveLength(1)
      const { headers, body } = received[0]!
      expect(Object.keys(body).sort()).toEqual(['detectedAt', 'id', 'kind', 'text'])
      expect(body.kind).toBe('drill')
      expect(headers['idempotency-key']).toBe(body.id)
      expect(output).not.toContain('CANARYSECRET')
    })
  })

  it('exits non-zero on a failing channel, without printing the URL', async () => {
    await withServer(500, async (url) => {
      const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: url })
      expect(code, output).toBe(1)
      expect(output).toMatch(/result=http_5xx/)
      expect(output).not.toContain('CANARYSECRET')
    })
  })

  it('exits 2 when no URL is set', async () => {
    const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: '' })
    expect(code, output).toBe(2)
  })

  it('refuses a URL the adapter refuses, without printing it', async () => {
    const { code, output } = await runDrill([], {
      MODERATION_OPS_WEBHOOK_URL: 'http://CANARYSECRET.example.test/hook',
    })
    expect(code, output).toBe(1)
    expect(output).toMatch(/result=invalid_config/)
    expect(output.toLowerCase()).not.toContain('canarysecret')
  })
})

// What the dashboard and the runbook claim is checked against the code and against what this story
// can honestly state.
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8')

const telemetry = read('apps/api/src/modules/moderation/moderation-sla.telemetry.ts')
const exported = [
  ...(/MODERATION_SLA_METRIC_NAMES = \[([\s\S]*?)\]/.exec(telemetry)?.[1] ?? '').matchAll(
    /'([^']+)'/g
  ),
].map((match) => match[1] as string)

describe('U-GF-METRICS: couturecast-moderation-sla.json', () => {
  const raw = read('infra/grafana/dashboards/couturecast-moderation-sla.json')
  const dashboard = JSON.parse(raw) as {
    panels?: {
      title?: string
      type?: string
      targets?: { expr?: string; instant?: boolean; range?: boolean }[]
      fieldConfig?: { defaults?: { noValue?: string } }
    }[]
  }
  const expressions = (dashboard.panels ?? []).flatMap((panel) =>
    (panel.targets ?? []).map((target) => target.expr ?? '')
  )
  const named = new Set(
    expressions.flatMap((expr) => expr.match(/moderation_sla_[a-z_]+/g) ?? [])
  )

  it('reads five metric names from the code', () => {
    expect(exported.length).toBe(5)
  })

  it('gates every panel on a gauge by the age of the last measurement (CX-5)', () => {
    const LAST = 'moderation_sla_last_measured_timestamp_seconds'
    const gauges = expressions.filter((expr) =>
      /moderation_sla_(open_cases|oldest_pending_review_age_seconds)/.test(expr)
    )
    expect(gauges.length).toBeGreaterThan(0)
    for (const expr of gauges) {
      expect(expr).toContain(LAST)
      expect(expr).toMatch(/time\(\)\s*-/)
      expect(expr).toMatch(/<\s*300\b/)
    }
  })

  it('lets no stat panel on a gauge fall back to an older point in the time range (CX-5)', () => {
    // Real Grafana on 2026-11-05: with the gate empty, a range query and `lastNotNull` still showed
    // the last count from before the gate, so a stale zero read as a fresh zero.
    const stats = (dashboard.panels ?? []).filter(
      (panel) =>
        panel.type === 'stat' &&
        panel.targets?.some((target) =>
          /moderation_sla_(open_cases|oldest_pending_review_age_seconds)/.test(
            target.expr ?? ''
          )
        )
    )
    expect(stats.length).toBeGreaterThan(0)
    for (const panel of stats) {
      for (const target of panel.targets ?? []) {
        expect(target.instant).toBe(true)
        expect(target.range).toBe(false)
      }
      expect(panel.fieldConfig?.defaults?.noValue, panel.title).toBe('Stale')
    }
  })

  it('shows the age of the last measurement in its own panel (CX-5)', () => {
    expect(
      expressions.some((expr) =>
        /^time\(\)\s*-\s*max\(moderation_sla_last_measured_timestamp_seconds/.test(expr)
      )
    ).toBe(true)
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
