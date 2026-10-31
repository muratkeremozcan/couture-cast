// Story 3.7 Task 1 step 1 owner: implement shared Zod deep-link parser, slot mapping, and expiry validation
// Story 6.7 deep-link owner: the `app` source with `focus` and `focusToken` in `packages/utils/src/deep-link.ts` and `apps/mobile/src/lib/mobile-deep-link-handler.ts`
import { z } from 'zod'

export const deepLinkSourceSchema = z.enum(['widget', 'notification', 'watch', 'app'])
export type DeepLinkSource = z.infer<typeof deepLinkSourceSchema>

export const deepLinkSlotSchema = z.enum(['am', 'pm', 'evening', 'now', 'next'])
export type DeepLinkSlot = z.infer<typeof deepLinkSlotSchema>

export const deepLinkWidgetSizeSchema = z.enum(['small', 'medium'])
export type DeepLinkWidgetSize = z.infer<typeof deepLinkWidgetSizeSchema>

export const deepLinkNotificationTypeSchema = z.enum([
  'severe_weather',
  'community',
  'weather_alert',
])
export type DeepLinkNotificationType = z.infer<typeof deepLinkNotificationTypeSchema>

const nonEmptyIdentifierSchema = z.string().trim().min(1)

/**
 * Story 6.7: an in-app link that asks Community to focus one entry in the City
 * Spotlight. The token is fresh per activation, so a repeated token moves no focus.
 */
export const deepLinkFocusSchema = z.enum(['spotlight'])
export type DeepLinkFocus = z.infer<typeof deepLinkFocusSchema>

const deepLinkFields = z.object({
  source: deepLinkSourceSchema,
  slot: deepLinkSlotSchema.optional(),
  size: deepLinkWidgetSizeSchema.optional(),
  type: deepLinkNotificationTypeSchema.optional(),
  alertId: nonEmptyIdentifierSchema.optional(),
  cardId: nonEmptyIdentifierSchema.optional(),
  commentId: nonEmptyIdentifierSchema.optional(),
  parentId: nonEmptyIdentifierSchema.optional(),
  focus: deepLinkFocusSchema.optional(),
  focusToken: nonEmptyIdentifierSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
})

type DeepLinkFields = z.infer<typeof deepLinkFields>
function validateCommentTarget(payload: DeepLinkFields, context: z.RefinementCtx) {
  if (
    (payload.commentId || payload.parentId) &&
    (payload.source !== 'notification' ||
      payload.type !== 'community' ||
      !payload.cardId ||
      (payload.parentId && !payload.commentId))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['commentId'],
      message: 'Comment targets require a community card.',
    })
  }
}
function validateFocusTarget(payload: DeepLinkFields, context: z.RefinementCtx) {
  if (payload.focus === undefined && payload.focusToken === undefined) return
  if (
    payload.source !== 'app' ||
    payload.type !== 'community' ||
    !payload.cardId ||
    !payload.focus ||
    !payload.focusToken
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [payload.focus ? 'focusToken' : 'focus'],
      message: 'Focus targets require an app community card with a focus and its token.',
    })
  }
}
function validateRequiredTarget(payload: DeepLinkFields, context: z.RefinementCtx) {
  let missingField: 'slot' | 'type' | 'cardId' | 'alertId' | undefined
  if ((payload.source === 'widget' || payload.source === 'watch') && !payload.slot) {
    missingField = 'slot'
  } else if (payload.source === 'notification' && !payload.type) {
    missingField = 'type'
  } else if (
    (payload.source === 'notification' || payload.source === 'app') &&
    payload.type === 'community' &&
    !payload.cardId
  ) {
    missingField = 'cardId'
  } else if (
    payload.source === 'notification' &&
    payload.type === 'severe_weather' &&
    !payload.alertId
  ) {
    missingField = 'alertId'
  }

  if (missingField) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [missingField],
      message: `${payload.source} deep links require ${missingField}`,
    })
  }
}
export const deepLinkSchema = deepLinkFields.superRefine((payload, context) => {
  validateCommentTarget(payload, context)
  validateFocusTarget(payload, context)
  validateRequiredTarget(payload, context)
})

export type DeepLinkPayload = z.infer<typeof deepLinkSchema>

export interface DeepLinkResult {
  valid: boolean
  payload?: DeepLinkPayload
  errorReason?: string
}

const deepLinkIntentKeys = [
  'source',
  'slot',
  'size',
  'type',
  'alertId',
  'cardId',
  'commentId',
  'parentId',
  'focus',
  'focusToken',
  'expiresAt',
] as const

export function hasDeepLinkIntent(params: Record<string, unknown>): boolean {
  return deepLinkIntentKeys.some((key) => {
    const value = params[key]
    return Array.isArray(value)
      ? value.some((item) => item !== undefined && item !== null && item !== '')
      : value !== undefined && value !== null && value !== ''
  })
}

export function parseDeepLink(
  params: Record<string, unknown>,
  now: Date = new Date()
): DeepLinkResult {
  const rawSource = params.source
  if (rawSource === undefined || rawSource === null || rawSource === '') {
    return { valid: false, errorReason: 'Missing source parameter' }
  }

  const normalizedParams = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      const normalized: unknown = Array.isArray(value) ? value[0] : value
      return normalized === undefined || normalized === null || normalized === ''
        ? []
        : [[key, normalized]]
    })
  )

  const parsed = deepLinkSchema.safeParse(normalizedParams)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return {
      valid: false,
      errorReason: firstIssue
        ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
        : 'Invalid deep link parameters',
    }
  }

  if (
    parsed.data.expiresAt &&
    new Date(parsed.data.expiresAt).getTime() <= now.getTime()
  ) {
    return { valid: false, errorReason: 'Deep link expired' }
  }

  return {
    valid: true,
    payload: parsed.data,
  }
}

export type DeepLinkScenario = 'morning' | 'midday' | 'evening'

export interface DeepLinkScenarioContext {
  now?: Date
  nextForecastAt?: Date | string
  timeZone?: string
}

function hourInTimeZone(instant: Date, timeZone?: string): number {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone,
      }).format(instant)
    )
    return Number.isInteger(hour) ? hour : instant.getUTCHours()
  } catch {
    return instant.getUTCHours()
  }
}

function scenarioForHour(hour: number): DeepLinkScenario {
  return hour >= 6 && hour < 11
    ? 'morning'
    : hour >= 11 && hour < 17
      ? 'midday'
      : 'evening'
}

export function resolveDeepLinkScenario(
  slot: DeepLinkSlot,
  context: DeepLinkScenarioContext = {}
): DeepLinkScenario {
  if (slot === 'am') {
    return 'morning'
  }
  if (slot === 'pm') {
    return 'midday'
  }
  if (slot === 'evening') {
    return 'evening'
  }

  const now = context.now ?? new Date()
  const nextForecastAt =
    typeof context.nextForecastAt === 'string'
      ? new Date(context.nextForecastAt)
      : (context.nextForecastAt ?? now)
  const target =
    slot === 'next' && Number.isFinite(nextForecastAt.getTime()) ? nextForecastAt : now

  return scenarioForHour(hourInTimeZone(target, context.timeZone))
}
