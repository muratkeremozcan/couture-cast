// Story 6.12 test owner: I-W-DRILL, U-GF-METRICS and U-RB-RUNBOOK, the operating surface of the monitor.
// The drill is the real script through the real adapter against a real socket.
// DATABASE_URL points nowhere on every webhook run, so a webhook drill that touched a table would fail
// here. I-W-DRILL-PUSH (production follow-up 2026-11-19) is the one exception: the push drill reads
// moderator devices from its own disposable database, and Expo's URLs go to a loopback receiver.
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { newRunId, seedMember } from './helpers/moderation-queue-seed.js'

vi.setConfig({ testTimeout: 60_000 })

const repoRoot = path.resolve(__dirname, '../../..')
const SCRIPT = 'scripts/moderation-sla-drill.mjs'

async function runDrill(
  args: string[],
  env: Record<string, string>,
  preloads: string[] = []
) {
  const imports = ['tsx', ...preloads].flatMap((preload) => ['--import', preload])
  const child = spawn(process.execPath, [...imports, SCRIPT, ...args], {
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

  it('exits 2 and names both settings when neither a URL nor moderator ids are set', async () => {
    const { code, output } = await runDrill([], {
      MODERATION_OPS_WEBHOOK_URL: ' ',
      MODERATION_OPS_PUSH_USER_IDS: ' , ',
    })
    expect(code, output).toBe(2)
    expect(output).toContain(
      'moderation_sla_drill result=unconfigured: neither MODERATION_OPS_WEBHOOK_URL nor MODERATION_OPS_PUSH_USER_IDS is set'
    )
  })

  it('a webhook URL wins over moderator ids, and the database is never read', async () => {
    await withServer(204, async (url, received) => {
      const { code, output } = await runDrill([], {
        MODERATION_OPS_WEBHOOK_URL: url,
        MODERATION_OPS_PUSH_USER_IDS: 'mod-1,mod-2',
      })
      expect(code, output).toBe(0)
      expect(output).toMatch(/target=webhook result=delivered/)
      expect(received).toHaveLength(1)
      expect(received[0]!.body.kind).toBe('drill')
    })
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

describe('I-W-DRILL-PUSH: the drill through the push channel', () => {
  const PRELOAD = path.join(__dirname, 'helpers/expo-push-loopback.mjs')
  const database = isolatedCommunityDatabase()
  const prisma = new PrismaClient({ datasourceUrl: database.url })
  const devices: {
    moderator: string
    second: string
    denied: string
    granted: string[]
  } = {
    moderator: '',
    second: '',
    denied: '',
    granted: [],
  }

  const runId = newRunId()

  beforeAll(async () => {
    await database.migrate()
    const moderator = await seedMember(prisma, runId, 'moderator', { alias: false })
    const second = await seedMember(prisma, runId, 'second-moderator', { alias: false })
    const denied = await seedMember(prisma, runId, 'denied', { alias: false })
    const outsider = await seedMember(prisma, runId, 'outsider', { alias: false })
    const device = async (userId: string, permission: string) => {
      const token = `ExponentPushToken[tea-drill-${randomUUID()}]`
      await prisma.pushToken.create({ data: { user_id: userId, token, permission } })
      return token
    }
    devices.moderator = moderator.id
    devices.second = second.id
    devices.denied = denied.id
    // Each of the two named moderators holds a granted device, so a drill that reads only the
    // first named id misses one.
    devices.granted = [
      await device(moderator.id, 'granted'),
      await device(second.id, 'granted'),
    ].sort()
    await device(moderator.id, 'denied')
    await device(denied.id, 'denied')
    await device(outsider.id, 'granted')
  }, 120_000)

  afterAll(async () => {
    try {
      await prisma.$disconnect()
    } finally {
      await database.drop()
    }
  })

  /** A loopback Expo: every message accepted with a ticket id. */
  async function withExpo(run: (url: string, received: Received[]) => Promise<void>) {
    const received: Received[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        const parsed = JSON.parse(body) as { to: string }[]
        received.push({
          headers: { ...request.headers, path: request.url },
          body: parsed as unknown as Record<string, unknown>,
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            data: Array.isArray(parsed)
              ? parsed.map((message) => ({ status: 'ok', id: `ticket:${message.to}` }))
              : {},
          })
        )
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const { port } = server.address() as AddressInfo
      await run(`http://127.0.0.1:${port}`, received)
    } finally {
      server.close()
    }
  }

  // The preload must keep a drill test off the network: only Expo's two push routes are remapped
  // to the loopback, and every other destination, another exp.host path included, is refused. A
  // recording transport is installed before the preload, so the preload wraps it in place of the
  // real fetch: a refusal that still called through would show up in its calls.
  const RECORDING_TRANSPORT = `data:text/javascript,${encodeURIComponent(
    "globalThis.teaUnderlying = []; globalThis.fetch = (input) => { globalThis.teaUnderlying.push(String(input?.url ?? input)); return Promise.reject(new TypeError('tea: underlying transport')) }"
  )}`
  it.each([
    ['another host', 'https://example.test/hook', 'http://127.0.0.1:9'],
    [
      'another exp.host path',
      'https://exp.host/--/api/v2/push/other',
      'http://127.0.0.1:9',
    ],
    ['Expo send with no loopback set', 'https://exp.host/--/api/v2/push/send', ''],
  ])(
    'the Expo preload refuses %s without calling the transport',
    (_name, url, loopback) => {
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          RECORDING_TRANSPORT,
          '--import',
          PRELOAD,
          '--input-type=module',
          '-e',
          `const message = await fetch(${JSON.stringify(url)}).then(() => 'resolved', (error) => error.message); console.log(JSON.stringify({ message, underlying: globalThis.teaUnderlying }))`,
        ],
        { encoding: 'utf8', env: { ...process.env, TEA_EXPO_LOOPBACK_URL: loopback } }
      )
      expect(child.status, child.stderr).toBe(0)
      expect(JSON.parse(child.stdout.trim())).toEqual({
        message: `tea: unexpected fetch ${url}`,
        underlying: [],
      })
    }
  )

  // The control: a remapped Expo route does reach the transport, at the loopback.
  it('the Expo preload sends Expo send to the loopback through the transport', () => {
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        RECORDING_TRANSPORT,
        '--import',
        PRELOAD,
        '--input-type=module',
        '-e',
        "await fetch('https://exp.host/--/api/v2/push/send').catch(() => undefined); console.log(JSON.stringify(globalThis.teaUnderlying))",
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, TEA_EXPO_LOOPBACK_URL: 'http://127.0.0.1:9' },
      }
    )
    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout.trim())).toEqual([
      'http://127.0.0.1:9/--/api/v2/push/send',
    ])
  })

  it('sends one generic drill push to each granted device of the named moderators and exits 0', async () => {
    await withExpo(async (loopback, received) => {
      const { code, output } = await runDrill(
        [],
        {
          DATABASE_URL: database.url,
          MODERATION_OPS_PUSH_USER_IDS: `${devices.moderator} ${devices.second} ${devices.denied}`,
          EXPO_PUSH_ACCESS_TOKEN: 'CANARYEXPOTOKEN',
          TEA_EXPO_LOOPBACK_URL: loopback,
        },
        [PRELOAD]
      )
      expect(code, output).toBe(0)
      expect(output).toMatch(/moderation_sla_drill target=push result=delivered/)
      expect(output).not.toContain('CANARYEXPOTOKEN')
      expect(received).toHaveLength(1)
      expect(received[0]!.headers.path).toBe('/--/api/v2/push/send')
      expect(received[0]!.headers.authorization).toBe('Bearer CANARYEXPOTOKEN')
      const sent = received[0]!.body as unknown as { to: string }[]
      expect([...sent].sort((a, b) => a.to.localeCompare(b.to))).toEqual(
        devices.granted.map((to) => ({
          to,
          title: 'Moderation needs attention',
          body: 'Open the moderation console to review the queue.',
          priority: 'high',
          sound: 'default',
          channelId: 'community',
          data: { version: 1, source: 'moderation_sla' },
        }))
      )
    })
  })

  it('exits 1 with invalid_config and sends nothing when no named moderator has a granted device', async () => {
    await withExpo(async (loopback, received) => {
      const { code, output } = await runDrill(
        [],
        {
          DATABASE_URL: database.url,
          MODERATION_OPS_PUSH_USER_IDS: devices.denied,
          TEA_EXPO_LOOPBACK_URL: loopback,
        },
        [PRELOAD]
      )
      expect(code, output).toBe(1)
      expect(output).toMatch(/moderation_sla_drill target=push result=invalid_config/)
      expect(received).toEqual([])
    })
  })

  it('exits 1 with network when the database is unreachable, printing no credential', async () => {
    const { code, output } = await runDrill(
      [],
      {
        DATABASE_URL: 'postgresql://x:CANARYDBPASSWORD@127.0.0.1:1/none',
        MODERATION_OPS_PUSH_USER_IDS: 'mod-1',
      },
      [PRELOAD]
    )
    expect(code, output).toBe(1)
    expect(output).toMatch(/moderation_sla_drill target=push result=network/)
    expect(output).not.toContain('CANARYDBPASSWORD')
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
      datasource?: { uid?: string }
      targets?: {
        expr?: string
        instant?: boolean
        range?: boolean
        datasource?: { uid?: string }
      }[]
      fieldConfig?: { defaults?: { noValue?: string } }
    }[]
  }
  const datasourceUids = (dashboard.panels ?? []).flatMap((panel) =>
    [
      panel.datasource,
      ...(panel.targets ?? []).map((target) => target.datasource),
    ].flatMap((source) => (source?.uid ? [source.uid] : []))
  )
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

  it('gives the age panel no older value to fall back on when samples stop (R2-2)', () => {
    // With no samples, a range query and `lastNotNull` keep the last age under the 300-second red
    // threshold, so a dead exporter would read as healthy beside panels that say Stale.
    const age = (dashboard.panels ?? []).find((panel) =>
      panel.targets?.some(
        (target) =>
          target.expr?.includes('moderation_sla_last_measured_timestamp_seconds') &&
          !/moderation_sla_(open_cases|oldest_pending)/.test(target.expr)
      )
    )
    expect(age?.type).toBe('stat')
    for (const target of age?.targets ?? []) {
      expect(target.instant).toBe(true)
      expect(target.range).toBe(false)
    }
    expect(age?.fieldConfig?.defaults?.noValue).toBe('No samples')
  })

  it('shows the age of the last measurement in its own panel (CX-5)', () => {
    expect(
      expressions.some((expr) =>
        /^time\(\)\s*-\s*max\(moderation_sla_last_measured_timestamp_seconds/.test(expr)
      )
    ).toBe(true)
  })

  it('reads the datasource the local stack rewrites to one it provisions', () => {
    const rewrites = new Map(
      [
        ...read('scripts/prepare-local-grafana-dashboards.mjs').matchAll(
          /\['([^']+)',\s*'([^']+)'\]/g
        ),
      ].map((match) => [match[1] as string, match[2] as string])
    )
    const provisioned = [
      ...read('infra/grafana/local/provisioning/datasources/datasources.yaml').matchAll(
        /uid:\s*(\S+)/g
      ),
    ].map((match) => match[1] as string)
    expect(datasourceUids.length).toBeGreaterThan(0)
    for (const uid of datasourceUids) {
      expect([...rewrites.keys()]).toContain(uid)
      expect(provisioned).toContain(rewrites.get(uid))
    }
  })

  it('filters on the service name the exporter defaults to', () => {
    const exporterDefault = /OTEL_SERVICE_NAME \?\? '([^']+)'/.exec(
      read('apps/api/src/instrumentation.ts')
    )?.[1]
    expect(exporterDefault).toBeDefined()
    const metricQueries = expressions.filter((expr) => expr.includes('moderation_sla_'))
    expect(metricQueries.length).toBeGreaterThan(0)
    for (const expr of metricQueries) {
      for (const [, name] of expr.matchAll(/service_name="([^"]+)"/g)) {
        expect(name).toBe(exporterDefault)
      }
      expect(expr).toContain(`service_name="${exporterDefault}"`)
    }
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

  it('records the staffing sign-off Story 6.13 closed, with no roster behind it (D16)', () => {
    expect(runbook).toMatch(/D16/)
    expect(runbook).toMatch(/Signed off by the owner on 2026-11-05/)
    expect(runbook).toMatch(/No roster or schedule exists/)
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
