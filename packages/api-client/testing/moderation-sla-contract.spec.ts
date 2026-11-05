// Story 6.12 test owner: the SLA read route and the operations webhook contract.
// U-C-RESPONSE-STRICT, U-C-PAYLOAD-STRICT, U-C-ENUMS, and the OpenAPI half of C-OPENAPI.
// The golden payload is written out by hand from the spec Design Notes, so a drift fails here.
import { describe, expect, it } from 'vitest'
import { generateHttpOpenApiDocument } from '../src/contracts/http/openapi'
import {
  MODERATION_SLA_MONITOR_STALE_MS,
  MODERATION_SLA_RECENT_ALERTS_LIMIT,
  MODERATION_SLA_RESOLUTION_WINDOW_DAYS,
  moderationSlaAlertKinds,
  moderationSlaDeliveryStates,
  moderationSlaDrillPayloadSchema,
  moderationSlaErrorSchema,
  moderationSlaFailureCodes,
  moderationSlaResponseSchema,
  moderationSlaWebhookPayloadSchema,
} from '../src/contracts/http/moderation-sla'

const ISO = '2026-11-06T09:00:00.000Z'
const recentAlert = {
  id: 'alert-1',
  kind: 'breached',
  caseId: 'post.abc',
  source: 'post',
  risk: 'high',
  slaDueAt: ISO,
  detectedAt: ISO,
  delivery: 'delivered',
  attempts: 1,
  lastErrorCode: null,
  deliveredAt: ISO,
} as const
const summary = {
  serverNow: ISO,
  monitor: { lastSweepAt: ISO, stale: false, channel: 'webhook' },
  queue: { onTrack: 1, atRisk: 2, breached: 3, escalated: 1, oldestDueAt: ISO },
  resolution: { windowDays: 7, resolved: 3, withinSla: 2, late: 1 },
  alerts: { pending: 1, failing: 1, consoleOnly: 0 },
  screening: { oldestPendingReviewAt: null },
  recentAlerts: [recentAlert],
} as const
const golden = {
  id: 'clx1',
  kind: 'breached',
  source: 'post',
  risk: 'high',
  slaDueAt: '2026-11-06T09:00:00.000Z',
  detectedAt: '2026-11-06T09:00:41.000Z',
  casePath: '/moderation/cases/post.abc',
  caseUrl: 'https://example.test/moderation/cases/post.abc',
  text: 'Moderation SLA breached: high risk post case. https://example.test/moderation/cases/post.abc',
} as const

/** Every key at every depth of a value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)])
  return []
}

describe('U-C-RESPONSE-STRICT', () => {
  it('accepts a maximal summary, and null where a value does not exist yet', () => {
    expect(moderationSlaResponseSchema.parse({ data: summary }).data.queue.atRisk).toBe(2)
    expect(() =>
      moderationSlaResponseSchema.parse({
        data: {
          ...summary,
          monitor: { lastSweepAt: null, stale: true, channel: null },
          queue: { ...summary.queue, oldestDueAt: null },
          recentAlerts: [],
        },
      })
    ).not.toThrow()
  })

  it.each([
    ['the envelope', { data: summary, extra: 1 }],
    ['the summary', { data: { ...summary, extra: 1 } }],
    ['monitor', { data: { ...summary, monitor: { ...summary.monitor, url: 'x' } } }],
    ['queue', { data: { ...summary, queue: { ...summary.queue, extra: 1 } } }],
    [
      'resolution',
      { data: { ...summary, resolution: { ...summary.resolution, extra: 1 } } },
    ],
    ['alerts', { data: { ...summary, alerts: { ...summary.alerts, extra: 1 } } }],
    [
      'screening',
      { data: { ...summary, screening: { oldestPendingReviewAt: null, id: 'p' } } },
    ],
    [
      'a recent alert',
      { data: { ...summary, recentAlerts: [{ ...recentAlert, reporterId: 'r' }] } },
    ],
  ])('rejects an unknown key in %s', (_where, body) => {
    expect(moderationSlaResponseSchema.safeParse(body).success).toBe(false)
  })

  it('caps recent alerts and rejects a negative count or a foreign window', () => {
    const tooMany = Array.from(
      { length: MODERATION_SLA_RECENT_ALERTS_LIMIT + 1 },
      () => recentAlert
    )
    expect(
      moderationSlaResponseSchema.safeParse({
        data: { ...summary, recentAlerts: tooMany },
      }).success
    ).toBe(false)
    expect(
      moderationSlaResponseSchema.safeParse({
        data: { ...summary, queue: { ...summary.queue, breached: -1 } },
      }).success
    ).toBe(false)
    expect(
      moderationSlaResponseSchema.safeParse({
        data: { ...summary, resolution: { ...summary.resolution, windowDays: 30 } },
      }).success
    ).toBe(false)
  })

  it('names no private field at any depth of a parsed maximal body', () => {
    const parsed = moderationSlaResponseSchema.parse({ data: summary })
    const forbidden =
      /reason|excerpt|alias|reporter|subject|user|email|anchor|decision|webhook|url|details/i
    expect(keysOf(parsed).filter((key) => forbidden.test(key))).toEqual([])
  })

  it('pins the constants the D11 definitions depend on', () => {
    expect(MODERATION_SLA_MONITOR_STALE_MS).toBe(300_000)
    expect(MODERATION_SLA_RECENT_ALERTS_LIMIT).toBe(50)
    expect(MODERATION_SLA_RESOLUTION_WINDOW_DAYS).toBe(7)
  })
})

describe('U-C-PAYLOAD-STRICT', () => {
  it('accepts the golden example, and a null caseUrl for a host with no APP_URL', () => {
    expect(moderationSlaWebhookPayloadSchema.parse(golden)).toEqual(golden)
    expect(
      moderationSlaWebhookPayloadSchema.safeParse({ ...golden, caseUrl: null }).success
    ).toBe(true)
  })

  it.each([
    'reason',
    'excerpt',
    'alias',
    'reporterId',
    'subjectId',
    'anchorReportId',
    'decisionId',
    'caseId',
  ])('rejects the extra key %s', (key) => {
    expect(
      moderationSlaWebhookPayloadSchema.safeParse({ ...golden, [key]: 'x' }).success
    ).toBe(false)
  })

  it('rejects a drill kind on a case payload, and a case on a drill payload', () => {
    expect(
      moderationSlaWebhookPayloadSchema.safeParse({ ...golden, kind: 'drill' }).success
    ).toBe(false)
    const drill = { id: 'd1', kind: 'drill', detectedAt: ISO, text: 'Drill.' }
    expect(moderationSlaDrillPayloadSchema.parse(drill)).toEqual(drill)
    expect(
      moderationSlaDrillPayloadSchema.safeParse({
        ...drill,
        casePath: '/moderation/cases/post.a',
      }).success
    ).toBe(false)
  })

  it('rejects a case path outside the console', () => {
    expect(
      moderationSlaWebhookPayloadSchema.safeParse({ ...golden, casePath: '/account' })
        .success
    ).toBe(false)
  })
})

// C-OPENAPI below generates the document while this file is collected, so this also proves generation
// leaves the exported lists alone. zod-to-openapi pushes null into the values of a nullable enum.
describe('U-C-ENUMS', () => {
  it('holds the closed vocabularies the spec names', () => {
    expect([...moderationSlaAlertKinds]).toEqual(['at_risk', 'breached', 'escalated'])
    expect([...moderationSlaDeliveryStates]).toEqual([
      'pending',
      'delivered',
      'console_only',
      'superseded',
    ])
    expect([...moderationSlaFailureCodes].sort()).toEqual(
      [
        'timeout',
        'network',
        'http_3xx',
        'http_4xx',
        'http_5xx',
        'invalid_config',
        'interrupted',
      ].sort()
    )
  })
})

describe('C-OPENAPI', () => {
  const document = generateHttpOpenApiDocument() as {
    paths: Record<string, Record<string, Record<string, unknown>>>
    components: { schemas: Record<string, unknown> }
  }

  it('registers the route with its 401, 403 and 503', () => {
    const operation = document.paths['/api/v1/moderation/sla']?.get as {
      operationId: string
      responses: Record<string, unknown>
    }
    expect(operation.operationId).toBe('getModerationSla')
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '401', '403', '503'])
  })

  it('registers the response and error schemas with closed enums equal to the contract', () => {
    expect(document.components.schemas.ModerationSlaResponse).toBeDefined()
    expect(document.components.schemas.ModerationSlaError).toBeDefined()
    const serialized = JSON.stringify(document.components.schemas.ModerationSlaResponse)
    for (const code of moderationSlaFailureCodes) expect(serialized).toContain(code)
    for (const state of moderationSlaDeliveryStates) expect(serialized).toContain(state)
    expect(
      moderationSlaErrorSchema.safeParse({ statusCode: 503, code: 'other', message: 'x' })
        .success
    ).toBe(false)
  })
})
