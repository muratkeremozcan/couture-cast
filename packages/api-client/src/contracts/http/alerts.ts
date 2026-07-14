import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import type { RegisteredCommonHttpSchemas } from './common'

const quietHoursTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const isValidTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

export const alertRuleTypeSchema = z.enum(['temperature', 'precipitation', 'severe'])

export const quietHoursTimeSchema = z
  .string()
  .regex(quietHoursTimePattern, 'Quiet-hours times must use HH:MM in 24-hour format.')

export const notificationTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(isValidTimezone, 'Timezone must be a valid IANA timezone name.')

const alertRuleFields = {
  enabled: z.boolean(),
}

export const alertRuleSchema = z.discriminatedUnion('ruleType', [
  z
    .object({
      ruleType: z.literal('temperature'),
      threshold: z.number().finite().positive().max(100),
      ...alertRuleFields,
    })
    .strict(),
  z
    .object({
      ruleType: z.literal('precipitation'),
      threshold: z.number().finite().min(0).max(1),
      ...alertRuleFields,
    })
    .strict(),
  z
    .object({
      ruleType: z.literal('severe'),
      threshold: z.number().int().min(1).max(3),
      ...alertRuleFields,
    })
    .strict(),
])

export const alertPreferencesSchema = z
  .object({
    quietHoursEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    quietHoursStart: quietHoursTimeSchema,
    quietHoursEnd: quietHoursTimeSchema,
    timezone: notificationTimezoneSchema,
  })
  .strict()
  .superRefine((preferences, context) => {
    if (
      preferences.quietHoursEnabled &&
      preferences.quietHoursStart === preferences.quietHoursEnd
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quiet-hours start and end must differ when quiet hours are enabled.',
        path: ['quietHoursEnd'],
      })
    }
  })

const alertRulesSchema = z.array(alertRuleSchema).max(3)

export const updateAlertRulesInputSchema = z
  .object({
    rules: alertRulesSchema.min(1),
  })
  .strict()
  .superRefine(({ rules }, context) => {
    const seenRuleTypes = new Set<string>()

    rules.forEach((rule, index) => {
      if (seenRuleTypes.has(rule.ruleType)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rule type ${rule.ruleType} may only appear once.`,
          path: ['rules', index, 'ruleType'],
        })
      }

      seenRuleTypes.add(rule.ruleType)
    })
  })

export const updateNotificationPreferencesInputSchema = alertPreferencesSchema

export const getAlertPreferencesResponseSchema = z.object({
  data: z.object({
    preferences: alertPreferencesSchema,
    rules: alertRulesSchema,
  }),
})

export const updateAlertRulesResponseSchema = z.object({
  data: z.object({
    rules: alertRulesSchema,
  }),
})

export const updateNotificationPreferencesResponseSchema = z.object({
  data: z.object({
    preferences: alertPreferencesSchema,
  }),
})

export type AlertRuleType = z.infer<typeof alertRuleTypeSchema>
export type AlertRule = z.infer<typeof alertRuleSchema>
export type AlertPreferences = z.infer<typeof alertPreferencesSchema>
export type UpdateAlertRulesInput = z.infer<typeof updateAlertRulesInputSchema>
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesInputSchema
>
export type GetAlertPreferencesResponse = z.infer<
  typeof getAlertPreferencesResponseSchema
>
export type UpdateAlertRulesResponse = z.infer<typeof updateAlertRulesResponseSchema>
export type UpdateNotificationPreferencesResponse = z.infer<
  typeof updateNotificationPreferencesResponseSchema
>

export function registerAlertsContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('AlertRuleType', alertRuleTypeSchema)
  registry.register('AlertRule', alertRuleSchema)
  registry.register('AlertPreferences', alertPreferencesSchema)
  const registeredUpdateAlertRulesInputSchema = registry.register(
    'UpdateAlertRulesInput',
    updateAlertRulesInputSchema
  )
  const registeredUpdateNotificationPreferencesInputSchema = registry.register(
    'UpdateNotificationPreferencesInput',
    updateNotificationPreferencesInputSchema
  )
  const registeredGetAlertPreferencesResponseSchema = registry.register(
    'GetAlertPreferencesResponse',
    getAlertPreferencesResponseSchema
  )
  const registeredUpdateAlertRulesResponseSchema = registry.register(
    'UpdateAlertRulesResponse',
    updateAlertRulesResponseSchema
  )
  const registeredUpdateNotificationPreferencesResponseSchema = registry.register(
    'UpdateNotificationPreferencesResponse',
    updateNotificationPreferencesResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/alerts/preferences',
    tags: ['alerts'],
    summary: 'Get alert rules and notification preferences',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Alert settings returned successfully',
        content: {
          'application/json': {
            schema: registeredGetAlertPreferencesResponseSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/alerts/rules',
    tags: ['alerts'],
    summary: 'Upsert alert rules',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateAlertRulesInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Alert rules updated successfully',
        content: {
          'application/json': {
            schema: registeredUpdateAlertRulesResponseSchema,
          },
        },
      },
      400: {
        description: 'Alert rules failed validation',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/alerts/preferences',
    tags: ['alerts'],
    summary: 'Update notification preferences',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateNotificationPreferencesInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Notification preferences updated successfully',
        content: {
          'application/json': {
            schema: registeredUpdateNotificationPreferencesResponseSchema,
          },
        },
      },
      400: {
        description: 'Notification preferences failed validation',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })
}
