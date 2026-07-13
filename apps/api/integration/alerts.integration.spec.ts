import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAlertPreferencesResponseSchema,
  updateAlertRulesResponseSchema,
  updateNotificationPreferencesResponseSchema,
} from '@couture/api-client/contracts/http'

import {
  AccessTokenIdentityService,
  type AccessTokenIdentity,
} from '../src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import { AlertsController } from '../src/modules/alerts/alerts.controller'
import {
  PrismaAlertsRepository,
  type AlertRuleRecord,
  type NotificationPreferenceRecord,
} from '../src/modules/alerts/alerts.repository'
import { AlertsService } from '../src/modules/alerts/alerts.service'

type RuleUpsertArguments = {
  where: {
    user_id_rule_type: {
      user_id: string
      rule_type: string
    }
  }
  create: {
    user_id: string
    rule_type: string
    threshold: number
    enabled: boolean
  }
  update: {
    threshold: number
    enabled: boolean
  }
}

type PreferenceUpsertArguments = {
  where: { user_id: string }
  create: {
    user_id: string
    quiet_hours_enabled: boolean
    push_enabled: boolean
    quiet_hours_start: string
    quiet_hours_end: string
    timezone: string
  }
  update: {
    quiet_hours_enabled: boolean
    push_enabled: boolean
    quiet_hours_start: string
    quiet_hours_end: string
    timezone: string
  }
}

type AlertRuleTransactionClient = {
  alertRule: {
    findMany(arguments_: { where: { user_id: string } }): Promise<AlertRuleRecord[]>
    upsert(arguments_: RuleUpsertArguments): Promise<AlertRuleRecord>
  }
}

const now = new Date('2026-07-13T12:00:00.000Z')

class TransactionalAlertsPrisma {
  private readonly rules = new Map<string, AlertRuleRecord>()
  private readonly preferences = new Map<string, NotificationPreferenceRecord>()
  private nextRuleId = 1
  private nextPreferenceId = 1
  private failAtRuleUpsert: number | null = null

  readonly transactionRuleUpsertCounts: number[] = []

  readonly alertRule = {
    findMany: vi.fn(({ where }: { where: { user_id: string } }) =>
      Promise.resolve(this.findRules(this.rules, where.user_id))
    ),
  }

  readonly notificationPreference = {
    findUnique: vi.fn(({ where }: { where: { user_id: string } }) =>
      Promise.resolve(this.preferences.get(where.user_id) ?? null)
    ),
    upsert: vi.fn((arguments_: PreferenceUpsertArguments) => {
      const existing = this.preferences.get(arguments_.where.user_id)
      const preference: NotificationPreferenceRecord = existing
        ? {
            ...existing,
            ...arguments_.update,
            updated_at: now,
          }
        : {
            id: `preference-${this.nextPreferenceId++}`,
            ...arguments_.create,
            created_at: now,
            updated_at: now,
          }

      this.preferences.set(preference.user_id, preference)
      return Promise.resolve(preference)
    }),
  }

  readonly $transaction = vi.fn(
    async <T>(run: (transaction: AlertRuleTransactionClient) => Promise<T>) => {
      const workingRules = new Map(
        [...this.rules.entries()].map(([key, rule]) => [key, { ...rule }])
      )
      const transactionIndex = this.transactionRuleUpsertCounts.push(0) - 1
      const failAtRuleUpsert = this.failAtRuleUpsert
      this.failAtRuleUpsert = null

      const transaction: AlertRuleTransactionClient = {
        alertRule: {
          findMany: ({ where }) =>
            Promise.resolve(this.findRules(workingRules, where.user_id)),
          upsert: (arguments_) => {
            const upsertCount =
              (this.transactionRuleUpsertCounts[transactionIndex] ?? 0) + 1
            this.transactionRuleUpsertCounts[transactionIndex] = upsertCount

            if (upsertCount === failAtRuleUpsert) {
              throw new Error('Forced second alert-rule upsert failure')
            }

            const ownerKey = arguments_.where.user_id_rule_type
            const key = this.ruleKey(ownerKey.user_id, ownerKey.rule_type)
            const existing = workingRules.get(key)
            const rule: AlertRuleRecord = existing
              ? {
                  ...existing,
                  ...arguments_.update,
                  updated_at: now,
                }
              : {
                  id: `rule-${this.nextRuleId++}`,
                  ...arguments_.create,
                  created_at: now,
                  updated_at: now,
                }

            workingRules.set(key, rule)
            return Promise.resolve(rule)
          },
        },
      }

      const result = await run(transaction)
      this.rules.clear()
      for (const [key, rule] of workingRules) {
        this.rules.set(key, rule)
      }

      return result
    }
  )

  failOnSecondRuleUpsert() {
    this.failAtRuleUpsert = 2
  }

  private findRules(
    rules: Map<string, AlertRuleRecord>,
    userId: string
  ): AlertRuleRecord[] {
    return [...rules.values()]
      .filter((rule) => rule.user_id === userId)
      .map((rule) => ({ ...rule }))
  }

  private ruleKey(userId: string, ruleType: string) {
    return `${userId}:${ruleType}`
  }
}

const primaryUserHeaders = {
  authorization: 'Bearer primary-alert-token',
}

const foreignUserHeaders = {
  authorization: 'Bearer foreign-alert-token',
}

const alertIdentities: Record<string, AccessTokenIdentity> = {
  'primary-alert-token': { userId: 'alert-user-1', role: 'guardian' },
  'foreign-alert-token': { userId: 'alert-user-2', role: 'guardian' },
}

const resolveAlertIdentity = vi.fn((token: string) => {
  const identity = alertIdentities[token]
  return identity
    ? Promise.resolve(identity)
    : Promise.reject(new Error(`Unknown test access token: ${token}`))
})

const allRules = [
  {
    ruleType: 'temperature' as const,
    threshold: 7,
    enabled: true,
  },
  {
    ruleType: 'precipitation' as const,
    threshold: 0.45,
    enabled: true,
  },
  {
    ruleType: 'severe' as const,
    threshold: 2,
    enabled: true,
  },
]

const notificationPreferences = {
  quietHoursEnabled: true,
  pushEnabled: false,
  quietHoursStart: '21:30',
  quietHoursEnd: '06:15',
  timezone: 'America/Chicago',
}

describe('Alerts API integration', () => {
  let app: INestApplication | undefined
  let prisma: TransactionalAlertsPrisma

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    prisma = new TransactionalAlertsPrisma()
    resolveAlertIdentity.mockClear()
    const accessTokenIdentityService = {
      resolveIdentity: resolveAlertIdentity,
    } as unknown as AccessTokenIdentityService
    const guardianConsentStateService = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        {
          provide: PrismaClient,
          useValue: prisma,
        },
        PrismaAlertsRepository,
        AlertsService,
        {
          provide: GuardianConsentStateService,
          useValue: guardianConsentStateService,
        },
        {
          provide: AccessTokenIdentityService,
          useValue: accessTokenIdentityService,
        },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue(
        new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
      )
      .compile()

    app = moduleFixture.createNestApplication()
    app.useLogger(false)
    await app.init()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('round-trips all rules and push preferences without crossing owners', async () => {
    const rulesResponse = await request(getHttpServer())
      .put('/api/v1/alerts/rules')
      .set(primaryUserHeaders)
      .send({ rules: allRules })

    expect(resolveAlertIdentity).toHaveBeenCalledWith('primary-alert-token')
    expect(rulesResponse.status).toBe(200)
    expect(updateAlertRulesResponseSchema.parse(rulesResponse.body)).toEqual({
      data: { rules: allRules },
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.transactionRuleUpsertCounts).toEqual([3])

    const preferencesResponse = await request(getHttpServer())
      .put('/api/v1/alerts/preferences')
      .set(primaryUserHeaders)
      .send(notificationPreferences)

    expect(preferencesResponse.status).toBe(200)
    expect(
      updateNotificationPreferencesResponseSchema.parse(preferencesResponse.body)
    ).toEqual({ data: { preferences: notificationPreferences } })

    const foreignRule = {
      ruleType: 'severe' as const,
      threshold: 2,
      enabled: false,
    }
    const foreignRulesResponse = await request(getHttpServer())
      .put('/api/v1/alerts/rules')
      .set(foreignUserHeaders)
      .send({ rules: [foreignRule] })

    expect(foreignRulesResponse.status).toBe(200)

    const primarySettingsResponse = await request(getHttpServer())
      .get('/api/v1/alerts/preferences')
      .set(primaryUserHeaders)
    const primarySettings = getAlertPreferencesResponseSchema.parse(
      primarySettingsResponse.body
    )

    expect(primarySettingsResponse.status).toBe(200)
    expect(primarySettings).toEqual({
      data: {
        preferences: notificationPreferences,
        rules: allRules,
      },
    })

    const foreignSettingsResponse = await request(getHttpServer())
      .get('/api/v1/alerts/preferences')
      .set(foreignUserHeaders)
    const foreignSettings = getAlertPreferencesResponseSchema.parse(
      foreignSettingsResponse.body
    )

    expect(foreignSettingsResponse.status).toBe(200)
    expect(foreignSettings).toEqual({
      data: {
        preferences: {
          quietHoursEnabled: false,
          pushEnabled: true,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'UTC',
        },
        rules: [foreignRule],
      },
    })
  })

  it('derives ownership from the bearer token instead of spoofable headers', async () => {
    const createResponse = await request(getHttpServer())
      .put('/api/v1/alerts/rules')
      .set(primaryUserHeaders)
      .send({ rules: allRules })

    expect(createResponse.status).toBe(200)

    const spoofedResponse = await request(getHttpServer())
      .get('/api/v1/alerts/preferences')
      .set({
        authorization: primaryUserHeaders.authorization,
        'x-user-id': 'alert-user-2',
        'x-user-role': 'admin',
      })
    const settings = getAlertPreferencesResponseSchema.parse(spoofedResponse.body)

    expect(spoofedResponse.status).toBe(200)
    expect(settings.data.rules).toEqual(allRules)
  })

  it('rolls back the complete rule update when the second upsert fails', async () => {
    const initialResponse = await request(getHttpServer())
      .put('/api/v1/alerts/rules')
      .set(primaryUserHeaders)
      .send({ rules: allRules })

    expect(initialResponse.status).toBe(200)
    prisma.failOnSecondRuleUpsert()

    const replacementRules = [
      { ...allRules[0], threshold: 12 },
      { ...allRules[1], threshold: 0.8 },
      { ...allRules[2], enabled: false },
    ]
    const failedResponse = await request(getHttpServer())
      .put('/api/v1/alerts/rules')
      .set(primaryUserHeaders)
      .send({ rules: replacementRules })

    expect(failedResponse.status).toBe(500)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(prisma.transactionRuleUpsertCounts).toEqual([3, 2])

    const settingsResponse = await request(getHttpServer())
      .get('/api/v1/alerts/preferences')
      .set(primaryUserHeaders)
    const settings = getAlertPreferencesResponseSchema.parse(settingsResponse.body)

    expect(settingsResponse.status).toBe(200)
    expect(settings.data.rules).toEqual(allRules)
  })
})
