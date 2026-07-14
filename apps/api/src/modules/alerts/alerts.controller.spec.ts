import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAlertPreferencesResponseSchema,
  updateAlertRulesResponseSchema,
  updateNotificationPreferencesResponseSchema,
} from '@couture/api-client/contracts/http'

import type { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../auth/security.guards'
import { AlertsController } from './alerts.controller'
import { AlertsService } from './alerts.service'

const authHeaders = {
  authorization: 'Bearer alert-token',
}

const preferences = {
  quietHoursEnabled: true,
  pushEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'America/Chicago',
}

const rules = [
  {
    ruleType: 'temperature' as const,
    threshold: 5,
    enabled: true,
  },
]

describe('AlertsController', () => {
  let app: INestApplication | undefined
  const service = {
    getSettings: vi.fn().mockResolvedValue({ preferences, rules }),
    updateNotificationPreferences: vi.fn().mockResolvedValue(preferences),
    updateRules: vi.fn().mockResolvedValue(rules),
  }

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    const guardianConsentStateService = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService
    const accessTokenIdentityService = {
      resolveIdentity: vi.fn((token: string) =>
        token === 'alert-token'
          ? Promise.resolve({ userId: 'user-1', role: 'teen' as const })
          : Promise.reject(new Error('Unknown test access token'))
      ),
    } as unknown as AccessTokenIdentityService

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        {
          provide: AlertsService,
          useValue: service,
        },
        {
          provide: GuardianConsentStateService,
          useValue: guardianConsentStateService,
        },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue(
        new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
      )
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    service.getSettings.mockClear()
    service.updateNotificationPreferences.mockClear()
    service.updateRules.mockClear()

    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('requires auth and returns settings for the authenticated user', async () => {
    const unauthorizedResponse = await request(getHttpServer()).get(
      '/api/v1/alerts/preferences'
    )
    expect(unauthorizedResponse.status).toBe(401)

    const response = await request(getHttpServer())
      .get('/api/v1/alerts/preferences')
      .set(authHeaders)

    expect(response.status).toBe(200)
    expect(getAlertPreferencesResponseSchema.parse(response.body)).toEqual({
      data: { preferences, rules },
    })
    expect(service.getSettings).toHaveBeenCalledWith('user-1')
  })

  it('upserts rules for the authenticated user and rejects client ownership', async () => {
    const rejectedResponse = await request(getHttpServer())
      .put('/api/v1/alerts/rules')
      .set(authHeaders)
      .send({ userId: 'other-user', rules })

    expect(rejectedResponse.status).toBe(400)
    expect(service.updateRules).not.toHaveBeenCalled()

    const response = await request(getHttpServer())
      .put('/api/v1/alerts/rules')
      .set({
        ...authHeaders,
        'x-user-id': 'spoofed-user',
        'x-user-role': 'admin',
      })
      .send({ rules })

    expect(response.status).toBe(200)
    expect(updateAlertRulesResponseSchema.parse(response.body)).toEqual({
      data: { rules },
    })
    expect(service.updateRules).toHaveBeenCalledWith('user-1', { rules })
  })

  it('validates quiet hours and timezone before updating preferences', async () => {
    for (const invalidInput of [
      { ...preferences, quietHoursStart: '7:00' },
      { ...preferences, timezone: 'Not/A_Timezone' },
    ]) {
      const invalidResponse = await request(getHttpServer())
        .put('/api/v1/alerts/preferences')
        .set(authHeaders)
        .send(invalidInput)

      expect(invalidResponse.status).toBe(400)
    }

    expect(service.updateNotificationPreferences).not.toHaveBeenCalled()

    const response = await request(getHttpServer())
      .put('/api/v1/alerts/preferences')
      .set(authHeaders)
      .send(preferences)

    expect(response.status).toBe(200)
    expect(updateNotificationPreferencesResponseSchema.parse(response.body)).toEqual({
      data: { preferences },
    })
    expect(service.updateNotificationPreferences).toHaveBeenCalledWith(
      'user-1',
      preferences
    )
  })
})
