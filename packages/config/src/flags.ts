/** Story 0.7 Task 8 owner file: shared feature-flag contract and request-time evaluation.
 * Why this file exists:
 * - Every runtime needs the same legal flag names and the same default answers.
 * - If each app invented its own list, flags would drift and tests would become misleading.
 * - We keep the contract in code so local/dev/test behavior stays deterministic even before PostHog responds.
 * Alternatives:
 * - Hardcode flags in each service.
 * - Read PostHog directly everywhere with no shared policy.
 * - Store defaults only in the database and hope every environment is seeded first.
 * Ownership anchors:
 * - Story 0.7 Task 8 step 1 owner: define the canonical flag keys, value kinds, and code defaults.
 * - Story 0.7 Task 8 step 3 owner: apply request-time fallback order: remote answer, then cache, then code default.
 * Flow refs:
 * - S0.7/T8/2: PostHog provides the remote answer when available.
 * - S0.7/T8/4: the API sync path keeps the fallback cache warm for step 3.
 */
type FeatureFlagScalarValue = boolean | string | number

type FeatureFlagJsonPrimitive = FeatureFlagScalarValue | null

type FeatureFlagJsonObject = {
  [key: string]: FeatureFlagJsonValue
}

type FeatureFlagJsonArray = FeatureFlagJsonValue[]

export type FeatureFlagJsonValue =
  | FeatureFlagJsonPrimitive
  | FeatureFlagJsonObject
  | FeatureFlagJsonArray

export type FeatureFlagStoredValue =
  | FeatureFlagScalarValue
  | FeatureFlagJsonObject
  | FeatureFlagJsonArray

type FeatureFlagValueKind = 'boolean' | 'string' | 'number' | 'json'

type FeatureFlagDefinition<TValue extends FeatureFlagStoredValue> = {
  defaultValue: TValue
  kind: FeatureFlagValueKind
}

const FEATURE_FLAG_DEFINITIONS = {
  // Story 5.3: the kill switch for the premium palette gallery, and this flag's
  // first real consumer (PremiumThemeService). Same defaults-false reasoning as
  // the two commerce flags below: a degraded PostHog can never switch a premium
  // surface ON by accident. The `true` lives only in
  // packages/db/prisma/seeds/feature-flags.ts, so the feature is on wherever the
  // seed has run and off everywhere else, production included, until someone
  // flips it -- the intended rollout shape, not an oversight. Scope: it gates
  // the PUT write path only. The GET always answers, because a non-entitled or
  // flag-off caller still needs `themesEnabled` to render the locked upsell or
  // the Default palette, which is AC 6's clean fallback.
  premium_themes_enabled: {
    kind: 'boolean',
    defaultValue: false,
  },
  community_feed_enabled: {
    kind: 'boolean',
    defaultValue: false,
  },
  // Story 5.4: the kill switch for palette analysis (selfie/wardrobe undertone
  // and depth derivation) and the sponsored beauty/accessory overlay. Flipped
  // from its original `true` default to `false` here: a consent-gated feature
  // that reads photographs of faces is the last flag in this repo that should
  // fail open. Same defaults-false reasoning as the three flags below -- a
  // degraded PostHog can never switch it ON by accident -- and the same
  // seed-overrides-code-default shape as premium_themes_enabled: the `true`
  // lives only in packages/db/prisma/seeds/feature-flags.ts. Scope: it gates
  // consent grant, analyze, selfie allocate/commit, and the sponsored overlay.
  // The GET always answers, carrying `analysisEnabled`, because a flag-off or
  // non-entitled caller still needs to render the locked or unavailable state.
  color_analysis_enabled: {
    kind: 'boolean',
    defaultValue: false,
  },
  weather_alerts_enabled: {
    kind: 'boolean',
    defaultValue: true,
  },
  // Story 5.1: the kill switch for affiliate commerce. Defaults false so a
  // degraded PostHog can never switch commerce ON by accident -- the fallback
  // order is remote answer, then the FeatureFlag cache row, then this default,
  // and only the first two can ever say yes.
  commerce_affiliate_enabled: {
    kind: 'boolean',
    defaultValue: false,
  },
  // Story 5.2: the kill switch for premium subscription PURCHASING. Same
  // defaults-false reasoning as commerce_affiliate_enabled: a degraded PostHog
  // can never switch commerce ON by accident. Scope is deliberately narrow --
  // it gates checkout-session creation and the purchasesEnabled field on the
  // status response, and nothing else: webhooks always record, and status,
  // refresh, and the Customer Portal always work, because a paying user must
  // always be able to see and cancel their subscription.
  commerce_subscription_enabled: {
    kind: 'boolean',
    defaultValue: false,
  },
} as const satisfies Record<string, FeatureFlagDefinition<FeatureFlagStoredValue>>

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFINITIONS

export type FeatureFlagValue<K extends FeatureFlagKey = FeatureFlagKey> =
  (typeof FEATURE_FLAG_DEFINITIONS)[K]['defaultValue']

export type FeatureFlagRecord<K extends FeatureFlagKey = FeatureFlagKey> = {
  key: K
  value: FeatureFlagValue<K>
}

export type FeatureFlagEvaluationSubject = string

export type FeatureFlagAdapters = {
  readRemoteFlag: (
    flagKey: FeatureFlagKey,
    subjectId: FeatureFlagEvaluationSubject
  ) => Promise<unknown>
  readFallbackFlag: (flagKey: FeatureFlagKey) => Promise<FeatureFlagStoredValue | null>
}

export const FEATURE_FLAG_KEYS = Object.freeze(
  Object.keys(FEATURE_FLAG_DEFINITIONS) as FeatureFlagKey[]
)

export const FEATURE_FLAG_SYNC_DISTINCT_ID = 'feature-flags-fallback-sync'

function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return FEATURE_FLAG_KEYS.includes(value as FeatureFlagKey)
}

function parseFeatureFlagKey(value: string): FeatureFlagKey {
  if (!isFeatureFlagKey(value)) {
    throw new Error(`Unknown feature flag: ${value}`)
  }

  return value
}

function isFeatureFlagJsonObject(value: unknown): value is FeatureFlagJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every(isFeatureFlagJsonValue)
}

function isFeatureFlagJsonValue(value: unknown): value is FeatureFlagJsonValue {
  if (value === null) return true

  if (typeof value === 'boolean' || typeof value === 'string') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every(isFeatureFlagJsonValue)
  }

  return isFeatureFlagJsonObject(value)
}

export function coerceFeatureFlagValue<K extends FeatureFlagKey>(
  flagKey: K,
  value: unknown
): FeatureFlagValue<K> | undefined {
  const kind = FEATURE_FLAG_DEFINITIONS[flagKey].kind as FeatureFlagValueKind

  switch (kind) {
    case 'boolean':
      return (typeof value === 'boolean' ? value : undefined) as
        | FeatureFlagValue<K>
        | undefined
    case 'string':
      return (typeof value === 'string' ? value : undefined) as
        | FeatureFlagValue<K>
        | undefined
    case 'number':
      return (typeof value === 'number' && Number.isFinite(value) ? value : undefined) as
        | FeatureFlagValue<K>
        | undefined
    case 'json':
      return (
        isFeatureFlagJsonObject(value) || Array.isArray(value) ? value : undefined
      ) as FeatureFlagValue<K> | undefined
  }
}

export function getDefaultFeatureFlagValue<K extends FeatureFlagKey>(
  flagKey: K
): FeatureFlagValue<K> {
  return FEATURE_FLAG_DEFINITIONS[flagKey].defaultValue
}

// TypeScript overloads:
// 1) when the caller passes a known FeatureFlagKey, preserve the precise value type.
// 2) when the caller only has a plain string, fall back to the broader stored-value type.
// 3) only the final declaration below is emitted as runtime JavaScript.
export async function getFeatureFlag<K extends FeatureFlagKey>(
  flagKey: K,
  subjectId: FeatureFlagEvaluationSubject,
  adapters?: Partial<FeatureFlagAdapters>
): Promise<FeatureFlagValue<K>>
export async function getFeatureFlag(
  flagKey: string,
  subjectId: FeatureFlagEvaluationSubject,
  adapters?: Partial<FeatureFlagAdapters>
): Promise<FeatureFlagStoredValue>
export async function getFeatureFlag(
  flagKey: string,
  subjectId: FeatureFlagEvaluationSubject,
  adapters?: Partial<FeatureFlagAdapters>
): Promise<FeatureFlagStoredValue> {
  // Flow ref S0.7/T8/1: validate the requested key before any lookup so typos
  // fail fast instead of silently behaving like "flag disabled".
  const normalizedFlagKey = parseFeatureFlagKey(flagKey)

  try {
    if (adapters?.readRemoteFlag) {
      // Flow ref S0.7/T8/2: ask the remote provider first because it is the
      // source of truth for rollout state.
      const remoteValue = await adapters.readRemoteFlag(normalizedFlagKey, subjectId)
      const coercedRemoteValue = coerceFeatureFlagValue(normalizedFlagKey, remoteValue)
      if (coercedRemoteValue !== undefined) {
        return coercedRemoteValue
      }
    }
  } catch {
    // 3) degrade gracefully: a provider outage should not force every caller to
    // reimplement fallback logic.
  }

  let coercedFallbackValue: FeatureFlagStoredValue | undefined
  try {
    const fallbackValue = adapters?.readFallbackFlag
      ? await adapters.readFallbackFlag(normalizedFlagKey)
      : null
    coercedFallbackValue =
      fallbackValue === null
        ? undefined
        : coerceFeatureFlagValue(normalizedFlagKey, fallbackValue)
  } catch {
    // The cache is the second line of defence, not a hard dependency. This read
    // sat outside any try/catch, so a database blip rejected out of
    // getFeatureFlag entirely and took the code default down with it — the
    // opposite of the degradation promised above and required of flag reads.
    coercedFallbackValue = undefined
  }

  // Flow ref S0.7/T8/3: database cache first, code defaults last. This order
  // preserves the last known rollout instead of snapping back to hardcoded
  // defaults too early.
  return coercedFallbackValue ?? getDefaultFeatureFlagValue(normalizedFlagKey)
}
