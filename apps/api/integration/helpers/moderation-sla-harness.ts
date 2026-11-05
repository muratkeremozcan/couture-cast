// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: one disposable database, a real HTTP receiver and the real sweep.
// Flags, analytics, the logger, the meter and the clock are the only doubles.
// The adapter under test always talks to a real socket, so a passing delivery test proves bytes arrived.
import 'reflect-metadata'
import { once } from 'node:events'
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { PrismaClient, type CommunityReportReason } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { createModerationOpsChannel } from '../../src/modules/moderation/moderation-sla.channel.js'
import { ModerationSlaSweep } from '../../src/modules/moderation/moderation-sla.sweep.js'
import { isolatedCommunityDatabase } from './isolated-community-database.js'
import {
  SEED_DAY_MS,
  newRunId,
  seedComment,
  seedCommentReport,
  seedMember,
  seedPost,
  seedPostReport,
} from './moderation-queue-seed.js'

export const SLA_HOUR_MS = 3_600_000
export const SLA_MINUTE_MS = 60_000
export const SLA_SECOND_MS = 1_000

export type CapturedRequest = {
  method: string
  url: string
  headers: IncomingHttpHeaders
  raw: string
  body: Record<string, unknown>
}

type Responder = (request: CapturedRequest, response: ServerResponse) => void

/** A real local receiver. A script chooses the answer per request, a hang included. */
export async function startCaptureServer() {
  const received: CapturedRequest[] = []
  const waiters: (() => void)[] = []
  const parked = new Set<ServerResponse>()
  let responder: Responder = (_request, response) => {
    response.statusCode = 200
    response.end('{}')
  }

  const server: Server = createServer((incoming, response) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(raw) as Record<string, unknown>
      } catch {
        body = {}
      }
      const captured: CapturedRequest = {
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        headers: incoming.headers,
        raw,
        body,
      }
      received.push(captured)
      for (const wake of waiters.splice(0)) wake()
      responder(captured, response)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/ops`,
    tokenUrl: (token: string) => `http://127.0.0.1:${port}/ops/${token}?token=${token}`,
    port,
    received,
    reset() {
      received.length = 0
      responder = (_request, response) => {
        response.statusCode = 200
        response.end('{}')
      }
      for (const response of parked) response.destroy()
      parked.clear()
    },
    respondWith(status: number, headers: Record<string, string> = {}) {
      responder = (_request, response) => {
        response.writeHead(status, headers)
        response.end('{}')
      }
    },
    script(next: Responder) {
      responder = next
    },
    /** Takes the request and never answers until `reset` or `releaseParked`. */
    hang() {
      responder = (_request, response) => {
        parked.add(response)
      }
    },
    releaseParked(status = 200) {
      for (const response of parked) {
        response.statusCode = status
        response.end('{}')
      }
      parked.clear()
    },
    /** Resolves once `count` requests have arrived. Bounded by the Vitest timeout. */
    async waitForRequests(count: number) {
      while (received.length < count) {
        await new Promise<void>((resolve) => waiters.push(resolve))
      }
    },
    idsReceived: () => received.map((request) => String(request.body.id)),
    async close() {
      for (const response of parked) response.destroy()
      parked.clear()
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}

export type CaptureServer = Awaited<ReturnType<typeof startCaptureServer>>

export function createTestClock(start: Date) {
  let current = new Date(start)
  const reads = vi.fn(() => new Date(current))
  return {
    now: reads,
    reads,
    at(date: Date) {
      current = new Date(date)
    },
    advance(ms: number) {
      current = new Date(current.getTime() + ms)
    },
  }
}

/** Every log call as one searchable record. A scan runs over `text`. */
export function createLogSpy() {
  const entries: { level: 'info' | 'warn' | 'error'; args: unknown[] }[] = []
  const make =
    (level: 'info' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      entries.push({ level, args })
    }
  return {
    logger: { info: make('info'), warn: make('warn'), error: make('error') },
    entries,
    named: (name: string, level?: 'info' | 'warn' | 'error') =>
      entries.filter(
        (entry) =>
          (!level || entry.level === level) &&
          JSON.stringify(entry.args, serializeError).includes(name)
      ),
    text: () => JSON.stringify(entries, serializeError),
    clear: () => {
      entries.length = 0
    },
  }
}

/** Errors are not enumerable by default, and a log scan has to read their message and stack. */
const serializeError = (_key: string, value: unknown) =>
  value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
    : value

export function createMeterSpy() {
  return {
    setOpenCases: vi.fn<(state: string, count: number) => void>(),
    setOldestPendingReviewAgeSeconds: vi.fn<(seconds: number) => void>(),
    countAlert: vi.fn<(kind: string) => void>(),
    countDeliveryFailure: vi.fn<(code: string) => void>(),
  }
}

export type SlaSeedSource = 'post' | 'comment'

/** The sweep over a disposable database. Each spec file owns its database. */
export function moderationSlaTestContext(options: { now: Date }) {
  const database = isolatedCommunityDatabase()
  const prisma = new PrismaClient({ datasourceUrl: database.url })
  const runId = newRunId()
  const clock = createTestClock(options.now)
  const logs = createLogSpy()
  const meter = createMeterSpy()
  const analytics = { capture: vi.fn() }
  const flagValues = new Map<string, boolean>()
  const failingFlags = new Set<string>()
  const flags = {
    getFeatureFlag: vi.fn((key: string, _subject: string) =>
      failingFlags.has(key)
        ? Promise.reject(new Error('flag read failed'))
        : Promise.resolve(flagValues.get(key) ?? true)
    ),
  }
  const shared: { capture: CaptureServer | null; author: { id: string } | null } = {
    capture: null,
    author: null,
  }
  const extraClients: PrismaClient[] = []
  let sequence = 0

  beforeAll(async () => {
    await database.migrate()
    shared.capture = await startCaptureServer()
    shared.author = await seedMember(prisma, runId, 'author')
  }, 120_000)

  beforeEach(async () => {
    shared.capture?.reset()
    clock.at(options.now)
    clock.reads.mockClear()
    logs.clear()
    analytics.capture.mockClear()
    flags.getFeatureFlag.mockClear()
    for (const spy of Object.values(meter)) spy.mockClear()
    flagValues.clear()
    failingFlags.clear()
    await prisma.moderationSlaAlert.deleteMany()
    await prisma.moderationSlaMonitor.deleteMany()
    await prisma.jobFailure.deleteMany()
    // Reports stay, closed, because comment audit rows are append-only.
    await prisma.communityPostReport.updateMany({
      where: { resolved_at: null },
      data: { resolved_at: options.now },
    })
    await prisma.communityCommentReport.updateMany({
      where: { resolved_at: null },
      data: { resolved_at: options.now },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(async () => {
    await shared.capture?.close()
    await Promise.all(extraClients.map((client) => client.$disconnect()))
    try {
      await prisma.$disconnect()
    } finally {
      await database.drop()
    }
  })

  const capture = () => {
    if (!shared.capture) throw new Error('capture server not started')
    return shared.capture
  }

  type SweepOverrides = Partial<ConstructorParameters<typeof ModerationSlaSweep>[0]>
  const sweep = (overrides: SweepOverrides = {}) =>
    new ModerationSlaSweep({
      prisma,
      clock: clock.now,
      channel: createModerationOpsChannel({ url: capture().url }),
      flags: flags as never,
      analytics,
      logger: logs.logger as never,
      meter,
      appUrl: 'https://app.test',
      ...overrides,
    })

  /** One open case with `reporters` reports, due at `dueAt`. Later reports are due later. */
  async function seedCase(params: {
    dueAt: Date
    source?: SlaSeedSource
    reason?: CommunityReportReason
    reporters?: number
    caption?: string
    details?: string
    alias?: string
    laterReportGapMs?: number
    /** Report id suffixes, in insert order, for a test about how ids sort. */
    reportLabels?: readonly string[]
  }) {
    const label = `c${++sequence}`
    const source = params.source ?? 'post'
    const reason = params.reason ?? 'spam'
    const gap = params.laterReportGapMs ?? SLA_MINUTE_MS
    const count = params.reporters ?? 1
    const authorId = shared.author!.id
    const post = await seedPost(prisma, {
      runId,
      label,
      authorId,
      caption: params.caption ?? `Caption ${label}`,
      now: new Date(params.dueAt.getTime() - SEED_DAY_MS),
    })
    const reports: { id: string; dueAt: Date }[] = []
    if (source === 'post') {
      for (let index = 0; index < count; index++) {
        const reporter = await seedMember(prisma, runId, `${label}r${index}`, {
          alias: false,
        })
        const dueAt = new Date(params.dueAt.getTime() + index * gap)
        const row = await seedPostReport(prisma, {
          runId,
          label: `${label}-${params.reportLabels?.[index] ?? index}`,
          postId: post.id,
          reporterId: reporter.id,
          reason,
          createdAt: new Date(dueAt.getTime() - SEED_DAY_MS),
          dueAt,
          details: params.details ?? null,
          subjectAlias: params.alias ?? null,
        })
        reports.push({ id: row.id, dueAt })
      }
      return {
        caseId: `post.${post.id}`,
        source,
        targetId: post.id,
        authorId,
        anchorReportId: reports[0]!.id,
        reports,
      }
    }
    const comment = await seedComment(prisma, {
      runId,
      label,
      postId: post.id,
      authorId,
      now: new Date(params.dueAt.getTime() - SEED_DAY_MS),
    })
    for (let index = 0; index < count; index++) {
      const reporter = await seedMember(prisma, runId, `${label}r${index}`, {
        alias: false,
      })
      const dueAt = new Date(params.dueAt.getTime() + index * gap)
      const row = await seedCommentReport(prisma, {
        runId,
        label: `${label}-${index}`,
        commentId: comment.id,
        reporterId: reporter.id,
        reason,
        acceptedAt: new Date(dueAt.getTime() - SEED_DAY_MS),
      })
      reports.push({ id: row.id, dueAt })
    }
    return {
      caseId: `comment.${comment.id}`,
      source,
      targetId: comment.id,
      authorId,
      anchorReportId: reports[0]!.id,
      reports,
    }
  }

  const alerts = () =>
    prisma.moderationSlaAlert.findMany({
      orderBy: [{ detected_at: 'asc' }, { id: 'asc' }],
    })
  const alertByKey = (key: string) =>
    prisma.moderationSlaAlert.findUnique({ where: { dedupe_key: key } })
  const slaKey = (
    seeded: { source: string; anchorReportId: string },
    kind: 'at_risk' | 'breached'
  ) => `sla:${seeded.source}:${seeded.anchorReportId}:${kind}`

  /** A second client stands in for a second process: its own pool, its own connections. */
  const newClient = (extraOptions?: string) => {
    const url = new URL(database.url)
    if (extraOptions) url.searchParams.set('options', extraOptions)
    const client = new PrismaClient({ datasourceUrl: url.toString() })
    extraClients.push(client)
    return client
  }

  return {
    database,
    prisma,
    runId,
    clock,
    logs,
    meter,
    analytics,
    flags,
    flagValues,
    failingFlags,
    capture,
    sweep,
    seedCase,
    alerts,
    alertByKey,
    slaKey,
    newClient,
  }
}
