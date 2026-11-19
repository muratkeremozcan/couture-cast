// Production follow-up 2026-11-19 test owner: the Expo push channel of the SLA sweep, on a real
// database. U-W-FACTORY-PUSH: `createModerationSlaSweep` reads MODERATION_OPS_PUSH_USER_IDS, asks for
// granted devices only, records the accepted tickets and stamps the monitor `push`.
// I-W-PUSH-RECEIPTS: the sweep settles owed receipts (ok, failed, unknown at expiry), defers the
// rest by 5 minutes, and a failed lookup or a database fault never fails the sweep.
// I-W-PUSH-RESTART: recorded tickets prove acceptance, so a restarted claim records delivered
// whatever the channel or the case did since, and is never pushed twice.
// Expo is the one thing replaced in the factory tests: its two URLs are forwarded to the harness's
// real local receiver, so every assertion reads bytes a socket got. The settle-path tests inject
// `readPushReceipts` and the harness clock. The adapter's request rules are unit-tested in
// src/modules/moderation/moderation-sla.rules.spec.ts (U-CH-PUSH-*, U-CH-RECEIPTS-READ).
import { randomUUID } from 'node:crypto'
import type * as PinoConfig from '../src/logger/pino.config.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createModerationOpsChannel,
  type ExpoPushReceipt,
  type ModerationOpsPushAccepted,
} from '../src/modules/moderation/moderation-sla.channel.js'
import { ModerationSlaRepository } from '../src/modules/moderation/moderation-sla.repository.js'
import { createModerationSlaSweep } from '../src/modules/moderation/moderation-sla.sweep.js'
import { seedMember } from './helpers/moderation-queue-seed.js'
import {
  SLA_HOUR_MS,
  SLA_MINUTE_MS,
  moderationSlaTestContext,
  refuseWrites,
} from './helpers/moderation-sla-harness.js'

vi.setConfig({ testTimeout: 60_000 })

// The factory builds its own pino logger. This sink keeps its JSON lines.
const logSink = vi.hoisted(() => {
  const lines: string[] = []
  return { lines, write: (line: string) => void lines.push(line) }
})
vi.mock('../src/logger/pino.config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PinoConfig>()
  return {
    ...actual,
    createBaseLogger: (options: Parameters<typeof actual.createBaseLogger>[0] = {}) =>
      actual.createBaseLogger({ ...options, destination: logSink }),
  }
})

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts'
const RETRY_MS = 5 * SLA_MINUTE_MS
const EXPIRY_MS = 24 * SLA_HOUR_MS
const NOW = new Date('2026-11-05T12:00:00.000Z')
const ctx = moderationSlaTestContext({ now: NOW })
const { prisma, runId, capture, clock, logs, seedCase, alertByKey, slaKey, analytics } =
  ctx
const at = (ms: number) => new Date(NOW.getTime() + ms)

type PushMessage = { to: string }
const LOCK_SCREEN = (to: string) => ({
  to,
  title: 'Moderation needs attention',
  body: 'Open the moderation console to review the queue.',
  priority: 'high',
  sound: 'default',
  channelId: 'community',
  data: { version: 1, source: 'moderation_sla' },
})

beforeEach(async () => {
  await prisma.moderationSlaPushReceipt.deleteMany()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  logSink.lines.length = 0
})

/** Expo's two URLs go to the real local receiver; anything else is refused. */
function forwardExpoToCapture() {
  const realFetch = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === EXPO_SEND) return realFetch(`${capture().url}/send`, init)
      if (url === EXPO_RECEIPTS) return realFetch(`${capture().url}/receipts`, init)
      return Promise.reject(new TypeError(`unexpected fetch ${url}`))
    })
  )
}

/** Expo answers: every message accepted with a ticket per device, and `receipts` for a lookup. */
function answerLikeExpo(
  receipts: (ids: string[]) => Record<string, unknown> = () => ({})
) {
  capture().script((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    if (request.url === '/ops/receipts') {
      const { ids } = request.body as { ids: string[] }
      response.end(JSON.stringify({ data: receipts(ids) }))
      return
    }
    const messages = request.body as unknown as PushMessage[]
    response.end(
      JSON.stringify({
        data: messages.map((message) => ({ status: 'ok', id: `ticket:${message.to}` })),
      })
    )
  })
}

async function seedDevice(userId: string, permission: string) {
  const token = `ExponentPushToken[tea-${randomUUID()}]`
  await prisma.pushToken.create({ data: { user_id: userId, token, permission } })
  return token
}

/**
 * Three named moderators and one outsider: the first two hold granted devices, the third only
 * denied and unknown ones, so a push that reaches only the first named id misses a device.
 */
async function seedModerators() {
  const label = randomUUID().slice(0, 6)
  const named = await seedMember(prisma, runId, `pushmod-a-${label}`)
  const namedSecond = await seedMember(prisma, runId, `pushmod-c-${label}`)
  const namedDenied = await seedMember(prisma, runId, `pushmod-b-${label}`)
  const outsider = await seedMember(prisma, runId, `pushout-${label}`)
  const granted = [
    await seedDevice(named.id, 'granted'),
    await seedDevice(named.id, 'granted'),
    await seedDevice(namedSecond.id, 'granted'),
  ]
  await seedDevice(named.id, 'denied')
  await seedDevice(namedDenied.id, 'denied')
  await seedDevice(namedDenied.id, 'unknown')
  await seedDevice(outsider.id, 'granted')
  return {
    ids: `${named.id}, ${namedSecond.id}, ${namedDenied.id}`,
    granted,
    namedDenied,
  }
}

const factorySweep = () =>
  createModerationSlaSweep({ prisma, flags: ctx.flags as never, analytics })
const monitorChannel = async () =>
  (await prisma.moderationSlaMonitor.findUnique({ where: { id: 'default' } }))?.channel
const requestsTo = (path: string) =>
  capture().received.filter((request) => request.url === path)
const factoryLogs = (event: string) =>
  logSink.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.event === event)

describe('U-W-FACTORY-PUSH: the composition with moderator ids and no webhook', () => {
  it('sends one generic message to each granted device of the named moderators, records the tickets, and stamps push', async () => {
    const { ids, granted } = await seedModerators()
    vi.stubEnv('MODERATION_OPS_WEBHOOK_URL', '')
    vi.stubEnv('MODERATION_OPS_PUSH_USER_IDS', ids)
    vi.stubEnv('EXPO_PUSH_ACCESS_TOKEN', 'tea-expo-access-token')
    forwardExpoToCapture()
    answerLikeExpo()
    const seeded = await seedCase({ dueAt: new Date(Date.now() + SLA_HOUR_MS) })

    const before = Date.now()
    await expect(factorySweep().run()).resolves.toMatchObject({ delivered: 1, errors: 0 })

    expect(requestsTo('/ops/send')).toHaveLength(1)
    const [send] = requestsTo('/ops/send')
    expect(send!.method).toBe('POST')
    expect(send!.headers.authorization).toBe('Bearer tea-expo-access-token')
    const messages = send!.body as unknown as PushMessage[]
    expect([...messages].sort((a, b) => a.to.localeCompare(b.to))).toEqual(
      [...granted].sort().map(LOCK_SCREEN)
    )
    expect(send!.raw).not.toContain(seeded.caseId)
    // The first receipt look is 5 minutes out, so this run read none.
    expect(requestsTo('/ops/receipts')).toEqual([])
    expect(await monitorChannel()).toBe('push')
    const row = (await alertByKey(slaKey(seeded, 'at_risk')))!
    expect(row.delivery).toBe('delivered')

    const tickets = await prisma.moderationSlaPushReceipt.findMany({
      orderBy: { ticket_id: 'asc' },
    })
    expect(tickets.map((ticket) => ticket.ticket_id)).toEqual(
      [...granted].sort().map((token) => `ticket:${token}`)
    )
    for (const ticket of tickets) {
      expect(ticket).toMatchObject({
        alert_id: row.id,
        outcome: null,
        error: null,
        checked_at: null,
      })
      expect(ticket.accepted_at.getTime()).toBeGreaterThanOrEqual(before)
      expect(ticket.check_after.getTime() - ticket.accepted_at.getTime()).toBe(RETRY_MS)
      expect(ticket.expires_at.getTime() - ticket.accepted_at.getTime()).toBe(EXPIRY_MS)
    }
  })

  it('logs a ticket write that fails by its closed fields, keeps the alert delivered, and never pushes it again', async () => {
    const { ids } = await seedModerators()
    vi.stubEnv('MODERATION_OPS_WEBHOOK_URL', '')
    vi.stubEnv('MODERATION_OPS_PUSH_USER_IDS', ids)
    vi.stubEnv('EXPO_PUSH_ACCESS_TOKEN', 'tea-expo-access-token')
    forwardExpoToCapture()
    answerLikeExpo()
    const seeded = await seedCase({ dueAt: new Date(Date.now() + SLA_HOUR_MS) })
    const allow = await refuseWrites(prisma, {
      table: 'ModerationSlaPushReceipt',
      event: 'INSERT',
    })
    try {
      await expect(factorySweep().run()).resolves.toMatchObject({
        delivered: 1,
        errors: 0,
      })
    } finally {
      await allow()
    }

    const row = (await alertByKey(slaKey(seeded, 'at_risk')))!
    expect(row.delivery).toBe('delivered')
    expect(await prisma.moderationSlaPushReceipt.count()).toBe(0)
    const failed = factoryLogs('moderation_sla_push_ticket_record_failed')
    expect(failed).toHaveLength(1)
    // A trigger's RAISE reaches Prisma with no P-code, so the closed field is null.
    // The whole application payload, past the logger's standard envelope: no ticket id, token or
    // error text rides along.
    const { level, timestamp, service, message, ...payload } = failed[0]!
    expect({ level, message }).toEqual({
      level: 'warn',
      message: 'moderation_sla_push_ticket_record_failed',
    })
    expect(typeof timestamp).toBe('string')
    expect(typeof service).toBe('string')
    expect(payload).toEqual({
      feature: 'moderation-sla',
      event: 'moderation_sla_push_ticket_record_failed',
      alertId: row.id,
      prismaCode: null,
    })
    expect(logSink.lines.join('\n')).not.toContain('tea refuses this write')

    await factorySweep().run()
    expect(requestsTo('/ops/send')).toHaveLength(1)
  })

  it('reads owed receipts through Expo once they are due, and logs a failed one', async () => {
    const { ids, granted } = await seedModerators()
    vi.stubEnv('MODERATION_OPS_WEBHOOK_URL', '')
    vi.stubEnv('MODERATION_OPS_PUSH_USER_IDS', ids)
    vi.stubEnv('EXPO_PUSH_ACCESS_TOKEN', 'tea-expo-access-token')
    forwardExpoToCapture()
    // One failed receipt among the three granted devices; the other two are ok. The send test
    // above checks that both named moderators with granted devices receive the push.
    const tickets = [...granted].sort().map((token) => `ticket:${token}`)
    const [dead, ...alive] = tickets
    answerLikeExpo((asked) =>
      Object.fromEntries(
        asked.map((id) => [
          id,
          id === dead
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok' },
        ])
      )
    )
    const seeded = await seedCase({ dueAt: new Date(Date.now() + SLA_HOUR_MS) })
    await factorySweep().run()
    const row = (await alertByKey(slaKey(seeded, 'at_risk')))!
    // Five minutes pass.
    await prisma.moderationSlaPushReceipt.updateMany({
      data: { check_after: new Date(Date.now() - 1_000) },
    })

    await factorySweep().run()

    const [lookup] = requestsTo('/ops/receipts')
    expect(requestsTo('/ops/receipts')).toHaveLength(1)
    expect(lookup!.headers.authorization).toBe('Bearer tea-expo-access-token')
    expect([...(lookup!.body as { ids: string[] }).ids].sort()).toEqual(tickets)
    expect(
      await prisma.moderationSlaPushReceipt.findMany({
        orderBy: { ticket_id: 'asc' },
        select: { ticket_id: true, outcome: true, error: true },
      })
    ).toEqual(
      [
        { ticket_id: dead!, outcome: 'failed', error: 'DeviceNotRegistered' },
        ...alive.map((ticket_id) => ({ ticket_id, outcome: 'ok', error: null })),
      ].sort((a, b) => a.ticket_id.localeCompare(b.ticket_id))
    )
    const logged = factoryLogs('moderation_sla_push_receipt_failed')
    expect(logged).toHaveLength(1)
    const { level, timestamp, service, message, ...payload } = logged[0]!
    expect({ level, message }).toEqual({
      level: 'warn',
      message: 'moderation_sla_push_receipt_failed',
    })
    expect(typeof timestamp).toBe('string')
    expect(typeof service).toBe('string')
    expect(payload).toEqual({
      feature: 'moderation-sla',
      event: 'moderation_sla_push_receipt_failed',
      alertId: row.id,
      error: 'DeviceNotRegistered',
    })
    expect(requestsTo('/ops/send')).toHaveLength(1)
  })

  it('records invalid_config and sends nothing when the named moderators have no granted device', async () => {
    const { namedDenied } = await seedModerators()
    vi.stubEnv('MODERATION_OPS_WEBHOOK_URL', '')
    vi.stubEnv('MODERATION_OPS_PUSH_USER_IDS', namedDenied.id)
    forwardExpoToCapture()
    answerLikeExpo()
    const seeded = await seedCase({ dueAt: new Date(Date.now() + SLA_HOUR_MS) })

    await expect(factorySweep().run()).resolves.toMatchObject({ delivered: 0, failed: 1 })

    expect(capture().received).toEqual([])
    expect(await monitorChannel()).toBe('push')
    expect(await alertByKey(slaKey(seeded, 'at_risk'))).toMatchObject({
      delivery: 'pending',
      last_error_code: 'invalid_config',
    })
    expect(await prisma.moderationSlaPushReceipt.count()).toBe(0)
  })

  it('a webhook URL wins: the payload goes to the webhook and no push is sent', async () => {
    const { ids } = await seedModerators()
    vi.stubEnv('MODERATION_OPS_WEBHOOK_URL', capture().url)
    vi.stubEnv('MODERATION_OPS_PUSH_USER_IDS', ids)
    vi.stubEnv('EXPO_PUSH_ACCESS_TOKEN', 'tea-expo-access-token')
    // Every outbound request is recorded; only the local webhook goes out, so a stray Expo call is
    // seen here and never reaches the provider.
    const realFetch = globalThis.fetch
    const outbound: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        outbound.push(url)
        if (url === capture().url) return realFetch(input, init)
        return Promise.reject(new TypeError(`unexpected fetch ${url}`))
      })
    )
    await seedCase({ dueAt: new Date(Date.now() + SLA_HOUR_MS) })

    await expect(factorySweep().run()).resolves.toMatchObject({ delivered: 1 })

    expect(outbound).toEqual([capture().url])
    expect(capture().received.map((request) => request.url)).toEqual(['/ops'])
    expect(await monitorChannel()).toBe('webhook')
    expect(await prisma.moderationSlaPushReceipt.count()).toBe(0)
  })

  it('blank moderator ids and no webhook leave the console channel', async () => {
    vi.stubEnv('MODERATION_OPS_WEBHOOK_URL', '')
    vi.stubEnv('MODERATION_OPS_PUSH_USER_IDS', ' , ')
    const seeded = await seedCase({ dueAt: new Date(Date.now() + SLA_HOUR_MS) })

    await factorySweep().run()

    expect(capture().received).toEqual([])
    expect(await monitorChannel()).toBe('console')
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('console_only')
  })
})

describe('I-W-PUSH-RECEIPTS: the sweep settles owed receipts', () => {
  const pushChannel = () =>
    createModerationOpsChannel({
      push: { userIds: ['mod-1'], tokens: () => Promise.resolve([]) },
    })
  type ReadReceipts = (ids: readonly string[]) => Promise<Map<string, ExpoPushReceipt>>
  const reader = (receipts: Record<string, ExpoPushReceipt> = {}) =>
    vi.fn<ReadReceipts>(() => Promise.resolve(new Map(Object.entries(receipts))))

  /** A delivered alert to own the receipts: the table's foreign key needs one. */
  async function deliveredAlert(id: string) {
    await prisma.moderationSlaAlert.create({
      data: {
        id,
        dedupe_key: `receipt:${id}:${randomUUID()}`,
        kind: 'at_risk',
        case_key: `post.${id}`,
        source: 'post',
        anchor_report_id: id,
        risk: 'low',
        sla_due_at: at(SLA_HOUR_MS),
        detected_at: at(-RETRY_MS),
        delivery: 'delivered',
        attempts: 1,
        next_attempt_at: at(-RETRY_MS),
        delivered_at: at(-RETRY_MS),
      },
    })
  }

  async function owe(
    ticketId: string,
    params: {
      checkAfter?: Date
      expiresAt?: Date
      outcome?: 'ok' | 'failed' | 'unknown'
    } = {}
  ) {
    await deliveredAlert(`alert-${ticketId}`)
    await prisma.moderationSlaPushReceipt.create({
      data: {
        ticket_id: ticketId,
        alert_id: `alert-${ticketId}`,
        accepted_at: at(-RETRY_MS),
        check_after: params.checkAfter ?? NOW,
        expires_at: params.expiresAt ?? at(EXPIRY_MS),
        outcome: params.outcome ?? null,
        checked_at: params.outcome ? at(-1) : null,
      },
    })
  }
  const receipt = (ticketId: string) =>
    prisma.moderationSlaPushReceipt.findUniqueOrThrow({ where: { ticket_id: ticketId } })

  it('settles ok, failed and expired receipts, defers the waiting one, and leaves the rest alone', async () => {
    await owe('t-ok', { checkAfter: at(-4 * SLA_MINUTE_MS) })
    await owe('t-fail', { checkAfter: at(-3 * SLA_MINUTE_MS) })
    await owe('t-wait', { checkAfter: at(-2 * SLA_MINUTE_MS), expiresAt: at(1) })
    await owe('t-expired', { checkAfter: at(-SLA_MINUTE_MS), expiresAt: NOW })
    await owe('t-later', { checkAfter: at(1) })
    await owe('t-settled', { checkAfter: at(-5 * SLA_MINUTE_MS), outcome: 'ok' })
    const read = reader({
      't-ok': { status: 'ok' },
      't-fail': { status: 'error', error: 'DeviceNotRegistered' },
    })

    await ctx.sweep({ channel: pushChannel(), readPushReceipts: read }).run()

    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith(['t-ok', 't-fail', 't-wait', 't-expired'])
    expect(await receipt('t-ok')).toMatchObject({
      outcome: 'ok',
      error: null,
      checked_at: NOW,
    })
    expect(await receipt('t-fail')).toMatchObject({
      outcome: 'failed',
      error: 'DeviceNotRegistered',
      checked_at: NOW,
    })
    expect(await receipt('t-wait')).toMatchObject({
      outcome: null,
      checked_at: null,
      check_after: at(RETRY_MS),
    })
    expect(await receipt('t-expired')).toMatchObject({
      outcome: 'unknown',
      error: null,
      checked_at: NOW,
    })
    expect(await receipt('t-later')).toMatchObject({ outcome: null, check_after: at(1) })
    expect(await receipt('t-settled')).toMatchObject({
      outcome: 'ok',
      checked_at: at(-1),
      check_after: at(-5 * SLA_MINUTE_MS),
    })

    const failed = logs.named('moderation_sla_push_receipt_failed')
    expect(failed.map((entry) => entry.level)).toEqual(['warn'])
    expect(failed[0]!.args[0]).toEqual({
      event: 'moderation_sla_push_receipt_failed',
      alertId: 'alert-t-fail',
      error: 'DeviceNotRegistered',
    })
    const unknown = logs.named('moderation_sla_push_receipt_unknown')
    expect(unknown).toHaveLength(1)
    expect(unknown[0]!.args[0]).toEqual({
      event: 'moderation_sla_push_receipt_unknown',
      alertId: 'alert-t-expired',
      readFailed: false,
    })
    expect(logs.named('moderation_sla_push_receipt_read_failed')).toEqual([])
    expect(await monitorChannel()).toBe('push')
  })

  it('a failed lookup defers the owed receipts, settles the expired one unknown, and the sweep still completes', async () => {
    await owe('t-a', { checkAfter: at(-2 * SLA_MINUTE_MS) })
    await owe('t-b', { checkAfter: at(-SLA_MINUTE_MS), expiresAt: NOW })
    const read = vi.fn<ReadReceipts>(() =>
      Promise.reject(new Error('receipt lookup answered 503'))
    )

    await expect(
      ctx.sweep({ channel: pushChannel(), readPushReceipts: read }).run()
    ).resolves.toMatchObject({ errors: 0 })

    expect(await receipt('t-a')).toMatchObject({
      outcome: null,
      checked_at: null,
      check_after: at(RETRY_MS),
    })
    expect(await receipt('t-b')).toMatchObject({ outcome: 'unknown', checked_at: NOW })
    const readFailed = logs.named('moderation_sla_push_receipt_read_failed')
    expect(readFailed).toHaveLength(1)
    expect(readFailed[0]!.args[0]).toEqual({
      event: 'moderation_sla_push_receipt_read_failed',
      owed: 2,
    })
    const unknown = logs.named('moderation_sla_push_receipt_unknown')
    expect(unknown.map((entry) => entry.args[0])).toEqual([
      {
        event: 'moderation_sla_push_receipt_unknown',
        alertId: 'alert-t-b',
        readFailed: true,
      },
    ])
    expect(logs.text()).not.toContain('answered 503')
    expect(await monitorChannel()).toBe('push')
  })

  it('a database fault while settling logs read_failed with its code, and the sweep still stamps', async () => {
    await owe('t-a')
    const restore = await refuseWrites(prisma, {
      table: 'ModerationSlaPushReceipt',
      event: 'UPDATE',
    })
    try {
      await expect(
        ctx
          .sweep({
            channel: pushChannel(),
            readPushReceipts: reader({ 't-a': { status: 'ok' } }),
          })
          .run()
      ).resolves.toMatchObject({ errors: 0 })
    } finally {
      await restore()
    }
    expect(await receipt('t-a')).toMatchObject({ outcome: null, check_after: NOW })
    const readFailed = logs.named('moderation_sla_push_receipt_read_failed')
    expect(readFailed).toHaveLength(1)
    // A trigger's RAISE reaches Prisma with no P-code, so the closed field is null.
    expect(readFailed[0]!.args[0]).toEqual({
      event: 'moderation_sla_push_receipt_read_failed',
      prismaCode: null,
    })
    expect(logs.text()).not.toContain('tea refuses this write')
    expect(await monitorChannel()).toBe('push')
  })

  it('looks again 5 minutes after a deferral, and not before', async () => {
    await owe('t-a')
    const read = reader()
    await ctx.sweep({ channel: pushChannel(), readPushReceipts: read }).run()
    expect(read).toHaveBeenCalledTimes(1)

    clock.at(at(RETRY_MS - 1))
    await ctx.sweep({ channel: pushChannel(), readPushReceipts: read }).run()
    expect(read).toHaveBeenCalledTimes(1)

    clock.at(at(RETRY_MS))
    await ctx.sweep({ channel: pushChannel(), readPushReceipts: read }).run()
    expect(read).toHaveBeenCalledTimes(2)
    expect(await receipt('t-a')).toMatchObject({
      outcome: null,
      check_after: at(2 * RETRY_MS),
    })
  })

  it('reads at most 1000 owed receipts per sweep, the longest owed first', async () => {
    const owedIds = Array.from({ length: 1001 }, (_unused, index) => `t-${index}`)
    await deliveredAlert('alert-bulk')
    await prisma.moderationSlaPushReceipt.createMany({
      data: owedIds.map((ticketId, index) => ({
        ticket_id: ticketId,
        alert_id: 'alert-bulk',
        accepted_at: at(-EXPIRY_MS),
        check_after: at(-(2_000 - index) * 1_000),
        expires_at: at(EXPIRY_MS),
      })),
    })
    const read = reader()

    await ctx.sweep({ channel: pushChannel(), readPushReceipts: read }).run()

    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]![0]).toEqual(owedIds.slice(0, 1000))
    expect(await receipt('t-999')).toMatchObject({ check_after: at(RETRY_MS) })
    expect(await receipt('t-1000')).toMatchObject({ check_after: at(-1_000 * 1_000) })
  })

  it.each([
    ['webhook', () => createModerationOpsChannel({ url: capture().url })],
    ['console', () => createModerationOpsChannel({ url: '' })],
  ])(
    'a %s channel still settles the receipts pushes already owe',
    async (kind, channel) => {
      await owe('t-a')
      const read = reader({ 't-a': { status: 'ok' } })
      await ctx.sweep({ channel: channel(), readPushReceipts: read }).run()
      expect(read).toHaveBeenCalledWith(['t-a'])
      expect(await receipt('t-a')).toMatchObject({ outcome: 'ok', checked_at: NOW })
      expect(await monitorChannel()).toBe(kind)
    }
  )
})

describe('I-W-PUSH-RESTART: recorded tickets prove acceptance at the next claim', () => {
  const repository = () => new ModerationSlaRepository(prisma)
  const ACCEPTED_AT = at(-7_000)
  const record: ModerationOpsPushAccepted = (alertId, ticketIds) =>
    repository().recordPushTickets(
      alertId,
      ticketIds,
      ACCEPTED_AT,
      at(RETRY_MS),
      at(EXPIRY_MS)
    )
  /** A push channel to one device that counts what reaches Expo and which alerts it accepted. */
  function countingPush(onAccepted: ModerationOpsPushAccepted = record) {
    const accepted = vi.fn<ModerationOpsPushAccepted>(onAccepted)
    const sent = vi.fn<typeof fetch>((_input: RequestInfo | URL, init?: RequestInit) => {
      const messages = JSON.parse(init!.body as string) as PushMessage[]
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: messages.map(() => ({
              status: 'ok',
              id: `ticket:${randomUUID()}`,
            })),
          })
        )
      )
    })
    const channel = createModerationOpsChannel({
      fetch: sent,
      push: {
        userIds: ['mod-1'],
        tokens: () => Promise.resolve(['tok-1']),
        onAccepted: accepted,
      },
    })
    return { channel, sent, accepted }
  }
  /**
   * The first worker: Expo accepts and the tickets are written, then the delivered write fails, as
   * it would if the worker stopped there. A real database fault refuses only that write.
   */
  async function stopBeforeDeliveryWrite() {
    let allow: (() => Promise<void>) | undefined
    const first = countingPush(async (alertId, ticketIds) => {
      await record(alertId, ticketIds)
      allow = await refuseWrites(prisma, {
        table: 'ModerationSlaAlert',
        event: 'UPDATE',
        when: 'NEW.delivered_at IS NOT NULL',
      })
    })
    try {
      await expect(ctx.sweep({ channel: first.channel }).run()).rejects.toThrow(
        'moderation_sla_delivery_incomplete'
      )
    } finally {
      await allow?.()
    }
    expect(allow).toBeDefined()
    expect(first.sent).toHaveBeenCalledTimes(1)
    return first
  }
  async function stopAfterAcceptance(dueAt: Date) {
    const seeded = await seedCase({ dueAt })
    await stopBeforeDeliveryWrite()
    const owed = (await alertByKey(slaKey(seeded, 'at_risk')))!
    expect(owed).toMatchObject({ delivery: 'pending', delivered_at: null })
    expect(owed.lease_until).not.toBeNull()
    expect(
      await prisma.moderationSlaPushReceipt.count({ where: { alert_id: owed.id } })
    ).toBe(1)
    return { seeded, owed }
  }
  const recovered = {
    delivery: 'delivered',
    delivered_at: ACCEPTED_AT,
    lease_until: null,
    last_error_code: null,
  }

  it('on the same channel: the next claim records delivered at the acceptance time and pushes nothing', async () => {
    const { owed } = await stopAfterAcceptance(at(3 * SLA_HOUR_MS))
    clock.advance(2 * SLA_MINUTE_MS)
    const second = countingPush()

    await expect(ctx.sweep({ channel: second.channel }).run()).resolves.toMatchObject({
      delivered: 1,
      consoleOnly: 0,
      superseded: 0,
      errors: 0,
    })

    expect(second.sent).not.toHaveBeenCalled()
    expect(await alertByKey(owed.dedupe_key)).toMatchObject(recovered)
    expect(logs.named('moderation_sla_delivery_attempt_failed')).toEqual([])
  })

  it('clears the error code an earlier failed attempt left, along with the lease', async () => {
    const seeded = await seedCase({ dueAt: at(3 * SLA_HOUR_MS) })
    const failing = createModerationOpsChannel({
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('{}', { status: 503 }))
      ),
      push: { userIds: ['mod-1'], tokens: () => Promise.resolve(['tok-1']) },
    })
    await ctx.sweep({ channel: failing }).run()
    const key = slaKey(seeded, 'at_risk')
    expect(await alertByKey(key)).toMatchObject({
      last_error_code: 'http_5xx',
      attempts: 1,
    })

    clock.advance(2 * SLA_MINUTE_MS)
    await stopBeforeDeliveryWrite()
    expect(await alertByKey(key)).toMatchObject({ last_error_code: 'http_5xx' })

    clock.advance(2 * SLA_MINUTE_MS)
    await expect(
      ctx.sweep({ channel: countingPush().channel }).run()
    ).resolves.toMatchObject({
      delivered: 1,
    })
    expect(await alertByKey(key)).toMatchObject(recovered)
  })

  it('after the channel switched to console: the alert is delivered, not console_only', async () => {
    const { owed } = await stopAfterAcceptance(at(3 * SLA_HOUR_MS))
    clock.advance(2 * SLA_MINUTE_MS)

    await expect(
      ctx.sweep({ channel: createModerationOpsChannel({ url: '' }) }).run()
    ).resolves.toMatchObject({ delivered: 1, consoleOnly: 0 })

    expect(await alertByKey(owed.dedupe_key)).toMatchObject(recovered)
  })

  it('after the case breached: the at-risk alert is delivered, not superseded, and only the breach is pushed', async () => {
    const { seeded, owed } = await stopAfterAcceptance(at(SLA_HOUR_MS))
    clock.at(at(SLA_HOUR_MS + 2 * SLA_MINUTE_MS))
    const second = countingPush()

    await expect(ctx.sweep({ channel: second.channel }).run()).resolves.toMatchObject({
      delivered: 2,
      superseded: 0,
    })

    expect(await alertByKey(owed.dedupe_key)).toMatchObject(recovered)
    const breached = (await alertByKey(slaKey(seeded, 'breached')))!
    expect(second.accepted.mock.calls.map(([alertId]) => alertId)).toEqual([breached.id])
    expect(breached.delivery).toBe('delivered')
  })

  it('without tickets, a console channel still marks console_only and a past-due at-risk alert still supersedes', async () => {
    const live = await seedCase({ dueAt: at(3 * SLA_HOUR_MS) })
    const late = await seedCase({ dueAt: at(SLA_HOUR_MS) })
    await ctx
      .sweep({
        channel: createModerationOpsChannel({ url: 'http://example.test/refused' }),
      })
      .run()
    clock.at(at(SLA_HOUR_MS + 2 * SLA_MINUTE_MS))

    await ctx.sweep({ channel: createModerationOpsChannel({ url: '' }) }).run()

    expect((await alertByKey(slaKey(live, 'at_risk')))!.delivery).toBe('console_only')
    expect((await alertByKey(slaKey(late, 'at_risk')))!.delivery).toBe('superseded')
    expect(await prisma.moderationSlaPushReceipt.count()).toBe(0)
  })

  // Expo accepted, so a failed ticket write must not cause a second push: the alert counts as
  // delivered, with no receipts to read. U-W-FACTORY-PUSH checks the composition's log.
  it('a ticket write that fails still records delivered, so the next claim pushes nothing', async () => {
    const seeded = await seedCase({ dueAt: at(3 * SLA_HOUR_MS) })
    const first = countingPush(() => Promise.reject(new Error('ticket write failed')))
    await expect(ctx.sweep({ channel: first.channel }).run()).resolves.toMatchObject({
      delivered: 1,
      errors: 0,
    })
    expect(first.sent).toHaveBeenCalledTimes(1)
    expect(first.accepted).toHaveBeenCalledTimes(1)
    expect(await prisma.moderationSlaPushReceipt.count()).toBe(0)
    expect(await alertByKey(slaKey(seeded, 'at_risk'))).toMatchObject({
      delivery: 'delivered',
      lease_until: null,
      last_error_code: null,
    })

    clock.advance(2 * SLA_MINUTE_MS)
    const second = countingPush()
    await ctx.sweep({ channel: second.channel }).run()
    expect(second.sent).not.toHaveBeenCalled()
  })
})
