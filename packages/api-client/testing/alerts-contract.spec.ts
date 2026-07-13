import { describe, expect, it } from 'vitest'
import {
  alertPreferencesSchema,
  alertRuleSchema,
  getAlertPreferencesResponseSchema,
  generateHttpOpenApiDocument,
  updateAlertRulesInputSchema,
  updateAlertRulesResponseSchema,
  updateNotificationPreferencesInputSchema,
  updateNotificationPreferencesResponseSchema,
} from '../src/contracts/http'

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
    threshold: 6,
    enabled: true,
  },
  {
    ruleType: 'precipitation' as const,
    threshold: 0.65,
    enabled: true,
  },
  {
    ruleType: 'severe' as const,
    threshold: 2,
    enabled: true,
  },
]

describe('alert HTTP contracts', () => {
  it('validates alert settings request and response envelopes', () => {
    expect(alertPreferencesSchema.parse(preferences)).toEqual(preferences)

    for (const rule of rules) {
      expect(alertRuleSchema.parse(rule)).toEqual(rule)
    }

    expect(updateAlertRulesInputSchema.parse({ rules })).toEqual({ rules })
    expect(updateNotificationPreferencesInputSchema.parse(preferences)).toEqual(
      preferences
    )
    expect(
      getAlertPreferencesResponseSchema.parse({
        data: { preferences, rules },
      })
    ).toEqual({ data: { preferences, rules } })
    expect(updateAlertRulesResponseSchema.parse({ data: { rules } })).toEqual({
      data: { rules },
    })
    expect(
      updateNotificationPreferencesResponseSchema.parse({
        data: { preferences },
      })
    ).toEqual({ data: { preferences } })
  })

  it.each(['7:00', '24:00', '23:60', '  ', '22:00:00'])(
    'rejects invalid quiet-hours time %s',
    (quietHoursStart) => {
      expect(() =>
        updateNotificationPreferencesInputSchema.parse({
          ...preferences,
          quietHoursStart,
        })
      ).toThrow()
    }
  )

  it('rejects invalid or ambiguous notification preferences', () => {
    expect(() =>
      updateNotificationPreferencesInputSchema.parse({
        ...preferences,
        timezone: 'Not/A_Timezone',
      })
    ).toThrow()

    expect(() =>
      updateNotificationPreferencesInputSchema.parse({
        ...preferences,
        quietHoursEnd: preferences.quietHoursStart,
      })
    ).toThrow()

    expect(() =>
      updateNotificationPreferencesInputSchema.parse({
        ...preferences,
        userId: 'client-supplied-owner',
      })
    ).toThrow()
  })

  it('enforces rule-specific threshold semantics and unique rule types', () => {
    expect(() =>
      alertRuleSchema.parse({
        ruleType: 'temperature',
        threshold: Number.POSITIVE_INFINITY,
        enabled: true,
      })
    ).toThrow()

    expect(() =>
      alertRuleSchema.parse({
        ruleType: 'precipitation',
        threshold: 1.1,
        enabled: true,
      })
    ).toThrow()

    for (const threshold of [null, 0, 2.5, 4]) {
      expect(() =>
        alertRuleSchema.parse({
          ruleType: 'severe',
          threshold,
          enabled: true,
        })
      ).toThrow()
    }

    expect(() =>
      alertRuleSchema.parse({
        ruleType: 'wind',
        threshold: 20,
        enabled: true,
      })
    ).toThrow()

    expect(() =>
      updateAlertRulesInputSchema.parse({
        rules: [rules[0], rules[0]],
      })
    ).toThrow()
  })

  it('registers authenticated alert routes in OpenAPI', () => {
    const spec = generateHttpOpenApiDocument()
    const preferencesPath = spec.paths?.['/api/v1/alerts/preferences']
    const rulesPath = spec.paths?.['/api/v1/alerts/rules']

    expect(preferencesPath?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(preferencesPath?.get?.responses?.['200']).toBeDefined()
    expect(preferencesPath?.put?.security).toEqual([{ bearerAuth: [] }])
    expect(preferencesPath?.put?.responses?.['400']).toBeDefined()
    expect(rulesPath?.put?.security).toEqual([{ bearerAuth: [] }])
    expect(rulesPath?.put?.responses?.['200']).toBeDefined()
    expect(rulesPath?.put?.responses?.['400']).toBeDefined()
  })
})
