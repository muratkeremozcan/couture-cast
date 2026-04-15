import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import {
  badRequestHttpErrorSchema,
  forbiddenHttpErrorSchema,
  trackedResponseSchema,
  unauthorizedHttpErrorSchema,
} from '@couture/api-client/contracts/http'
import {
  createAnalyticsEventExpectations,
  type MemoryTrackedAnalyticsEvent,
} from '@couture/api-client/testing/analytics-event-assertions'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../test/factories.js'
import { AuthModule } from '../src/modules/auth/auth.module'
import { ModerationModule } from '../src/modules/moderation/moderation.module'

const { trackedEvents, posthogCaptureMock, posthogShutdownMock } = vi.hoisted(() => {
  const trackedEvents: MemoryTrackedAnalyticsEvent[] = []

  return {
    trackedEvents,
    posthogCaptureMock: vi.fn(
      (payload: {
        distinctId: string
        event: string
        properties?: Record<string, unknown>
      }) => {
        trackedEvents.push({
          distinctId: payload.distinctId,
          event: payload.event,
          properties: payload.properties,
        })
      }
    ),
    posthogShutdownMock: vi.fn(),
  }
})

vi.mock('posthog-node', () => ({
  PostHog: class PostHogMock {
    capture = posthogCaptureMock
    getFeatureFlag = vi.fn()
    shutdown = posthogShutdownMock
  },
}))

vi.mock('@prisma/client', () => {
  class PrismaClientMock {
    $disconnect = vi.fn()
  }
  return { PrismaClient: PrismaClientMock }
})

/** Story 0.7 support file: integration assertions for analytics tracking.
 * Why these assertions exist: unit tests alone can miss guard/routing regressions and payload-shape mismatches.
 * Problems solved: unauthorized event noise and schema drift that reduce observability quality.
 * Alternatives: end-to-end browser/mobile tests or contract tests against a collector mock; both are broader/slower.
 * Flow refs:
 * - S0.7/T3/1: integration coverage proves API routes reuse the shared analytics contract.
 * - S0.7/T2/2: assertions pin the exact emitted property shapes so snake_case drift is visible.
 */
describe('Analytics tracking endpoints (integration)', () => {
  let app: INestApplication | undefined
  const guardian = createGuardianProfileFixture({
    id: 'guardian-1',
    email: 'guardian1@example.com',
  })
  const alternateGuardian = createGuardianProfileFixture({
    id: 'guardian-2',
    email: 'guardian2@example.com',
    displayName: 'Jordan Casey',
  })
  const teen = createTeenProfileFixture({
    id: 'teen-1',
    email: 'teen1@example.com',
    age: 13,
    birthdate: new Date('2013-03-04T00:00:00.000Z'),
  })
  const originalEnv = { ...process.env }
  const eventExpectations = createAnalyticsEventExpectations(trackedEvents, expect)
  const createHeaders = (userId: string, role: 'guardian' | 'moderator' | 'admin') => ({
    authorization: 'Bearer test-token',
    'x-user-id': userId,
    'x-user-role': role,
  })
  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  // Flow ref S0.7/T3/1: boot Nest with capture mocked so HTTP routes can be
  // exercised without a real PostHog dependency.
  beforeEach(async () => {
    trackedEvents.splice(0, trackedEvents.length)
    posthogCaptureMock.mockClear()
    posthogShutdownMock.mockClear()
    process.env.POSTHOG_API_KEY = 'phc_test'
    process.env.POSTHOG_HOST = 'https://us.i.posthog.com'

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, ModerationModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }

    process.env = { ...originalEnv }
    resetCleanupRegistry()
  })

  // Flow ref S0.7/T3/1: exercise both authorized and unauthorized HTTP paths.
  it('returns 401 for guardian consent when auth headers are missing', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .send({
        guardianId: guardian.id,
        teenId: teen.id,
        consentLevel: 'full',
      })

    // Flow ref S0.7/T2/2: assert the exact emitted payload so property drift is
    // caught at the integration boundary.
    expect(response.status).toBe(401)
    unauthorizedHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('returns 400 for guardian consent when payload fails the shared contract', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set(createHeaders(guardian.id, 'guardian'))
      .send({
        guardianId: guardian.id,
      })

    expect(response.status).toBe(400)
    badRequestHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('returns 403 for guardian consent when role is not permitted', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set(createHeaders('mod-1', 'moderator'))
      .send({
        guardianId: guardian.id,
        teenId: teen.id,
        consentLevel: 'full',
      })

    expect(response.status).toBe(403)
    forbiddenHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('returns 403 for guardian consent when authenticated guardian does not match payload', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set(createHeaders(alternateGuardian.id, 'guardian'))
      .send({
        guardianId: guardian.id,
        teenId: teen.id,
        consentLevel: 'full',
      })

    expect(response.status).toBe(403)
    forbiddenHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('tracks guardian consent via HTTP endpoint for authorized guardian', async () => {
    const eventCursor = eventExpectations.createCursor()
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set(createHeaders(guardian.id, 'guardian'))
      .send({
        guardianId: guardian.id,
        teenId: teen.id,
        consentLevel: 'full',
        timestamp: '2026-03-04T10:00:00.000Z',
      })

    expect(response.status).toBe(200)
    expect(trackedResponseSchema.parse(response.body)).toEqual({ tracked: true })
    const trackedEvent = eventExpectations.expectEventTracked(
      'guardian_consent_granted',
      {
        guardian_id: guardian.id,
        teen_id: teen.id,
        consent_level: 'full',
        timestamp: '2026-03-04T10:00:00.000Z',
        consent_timestamp: '2026-03-04T10:00:00.000Z',
      },
      { afterIndex: eventCursor, count: 1 }
    )
    expect(trackedEvent.distinctId).toBe(guardian.id)
  })

  it('returns 401 for moderation action when auth headers are missing', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/moderation/actions')
      .send({
        moderatorId: 'mod-1',
        targetId: 'post-1',
        action: 'hide',
        reason: 'policy_violation',
      })

    expect(response.status).toBe(401)
    unauthorizedHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('returns 400 for moderation action when payload fails the shared contract', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/moderation/actions')
      .set(createHeaders('mod-1', 'moderator'))
      .send({
        moderatorId: 'mod-1',
      })

    expect(response.status).toBe(400)
    badRequestHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('returns 403 for moderation action when role is not permitted', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/moderation/actions')
      .set(createHeaders(guardian.id, 'guardian'))
      .send({
        moderatorId: 'mod-1',
        targetId: 'post-1',
        action: 'hide',
        reason: 'policy_violation',
      })

    expect(response.status).toBe(403)
    forbiddenHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('returns 403 for moderation action when authenticated moderator does not match payload', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/moderation/actions')
      .set(createHeaders('mod-2', 'moderator'))
      .send({
        moderatorId: 'mod-1',
        targetId: 'post-1',
        action: 'hide',
        reason: 'policy_violation',
      })

    expect(response.status).toBe(403)
    forbiddenHttpErrorSchema.parse(response.body)
    expect(trackedEvents).toHaveLength(0)
  })

  it('tracks moderation action via HTTP endpoint for authorized moderator', async () => {
    const eventCursor = eventExpectations.createCursor()
    const response = await request(getHttpServer())
      .post('/api/v1/moderation/actions')
      .set(createHeaders('mod-1', 'moderator'))
      .send({
        moderatorId: 'mod-1',
        targetId: 'post-1',
        action: 'hide',
        reason: 'policy_violation',
        contentType: 'post',
        timestamp: '2026-03-04T10:00:00.000Z',
      })

    expect(response.status).toBe(200)
    expect(trackedResponseSchema.parse(response.body)).toEqual({ tracked: true })
    const trackedEvent = eventExpectations.expectEventTracked(
      'moderation_action',
      {
        moderator_id: 'mod-1',
        target_id: 'post-1',
        action: 'hide',
        reason: 'policy_violation',
        content_type: 'post',
        timestamp: '2026-03-04T10:00:00.000Z',
      },
      { afterIndex: eventCursor, count: 1 }
    )
    expect(trackedEvent.distinctId).toBe('mod-1')
  })
})
