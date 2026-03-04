import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { PostHogService } from '../src/posthog/posthog.service'
import { AuthController } from '../src/modules/auth/auth.controller'
import { AuthService } from '../src/modules/auth/auth.service'
import { RequestAuthGuard, RolesGuard } from '../src/modules/auth/security.guards'
import { ModerationController } from '../src/modules/moderation/moderation.controller'
import { ModerationService } from '../src/modules/moderation/moderation.service'

vi.mock('@prisma/client', () => {
  class PrismaClientMock {
    $disconnect = vi.fn()
  }
  return { PrismaClient: PrismaClientMock }
})

describe('Analytics tracking endpoints (integration)', () => {
  let app: INestApplication | undefined
  const capture = vi.fn()
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

  beforeEach(async () => {
    capture.mockReset()

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, ModerationController],
      providers: [
        AuthService,
        ModerationService,
        RequestAuthGuard,
        RolesGuard,
        {
          provide: PostHogService,
          useValue: {
            capture,
          },
        },
      ],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('returns 401 for guardian consent when auth headers are missing', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .send({
        guardianId: 'guardian-1',
        teenId: 'teen-1',
        consentLevel: 'full',
      })

    expect(response.status).toBe(401)
    expect(capture).not.toHaveBeenCalled()
  })

  it('returns 403 for guardian consent when role is not permitted', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set(createHeaders('mod-1', 'moderator'))
      .send({
        guardianId: 'guardian-1',
        teenId: 'teen-1',
        consentLevel: 'full',
      })

    expect(response.status).toBe(403)
    expect(capture).not.toHaveBeenCalled()
  })

  it('returns 403 for guardian consent when authenticated guardian does not match payload', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set(createHeaders('guardian-2', 'guardian'))
      .send({
        guardianId: 'guardian-1',
        teenId: 'teen-1',
        consentLevel: 'full',
      })

    expect(response.status).toBe(403)
    expect(capture).not.toHaveBeenCalled()
  })

  it('tracks guardian consent via HTTP endpoint for authorized guardian', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/auth/guardian-consent')
      .set(createHeaders('guardian-1', 'guardian'))
      .send({
        guardianId: 'guardian-1',
        teenId: 'teen-1',
        consentLevel: 'full',
        timestamp: '2026-03-04T10:00:00.000Z',
      })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ tracked: true })
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'guardian-1',
      event: 'guardian_consent_granted',
      properties: {
        guardian_id: 'guardian-1',
        teen_id: 'teen-1',
        consent_level: 'full',
        timestamp: '2026-03-04T10:00:00.000Z',
        consent_timestamp: '2026-03-04T10:00:00.000Z',
      },
    })
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
    expect(capture).not.toHaveBeenCalled()
  })

  it('returns 403 for moderation action when role is not permitted', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/moderation/actions')
      .set(createHeaders('guardian-1', 'guardian'))
      .send({
        moderatorId: 'mod-1',
        targetId: 'post-1',
        action: 'hide',
        reason: 'policy_violation',
      })

    expect(response.status).toBe(403)
    expect(capture).not.toHaveBeenCalled()
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
    expect(capture).not.toHaveBeenCalled()
  })

  it('tracks moderation action via HTTP endpoint for authorized moderator', async () => {
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

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ tracked: true })
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'mod-1',
      event: 'moderation_action',
      properties: {
        moderator_id: 'mod-1',
        target_id: 'post-1',
        action: 'hide',
        reason: 'policy_violation',
        content_type: 'post',
        timestamp: '2026-03-04T10:00:00.000Z',
      },
    })
  })
})
