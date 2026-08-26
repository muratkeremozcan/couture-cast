/* eslint-disable */
export type FixedLengthArray<
  T,
  L extends number,
  Acc extends T[] = [],
> = Acc['length'] extends L ? Acc : FixedLengthArray<T, L, [...Acc, T]>

/**
 *
 * @export
 */
export const AdvisorAction = {
  saved: 'saved',
  dismissed: 'dismissed',
} as const
export type AdvisorAction = (typeof AdvisorAction)[keyof typeof AdvisorAction]

/**
 *
 * @export
 * @interface AdvisorRecommendationCard
 */
export interface AdvisorRecommendationCard {
  /**
   *
   * @type {AdvisorRecommendationCardSlotEnum}
   * @memberof AdvisorRecommendationCard
   */
  slot: AdvisorRecommendationCardSlotEnum
  /**
   *
   * @type {string}
   * @memberof AdvisorRecommendationCard
   */
  itemKey: string
  /**
   *
   * @type {string}
   * @memberof AdvisorRecommendationCard
   */
  labelKey: string
  /**
   *
   * @type {string}
   * @memberof AdvisorRecommendationCard
   */
  swatchHex: string
  /**
   *
   * @type {boolean}
   * @memberof AdvisorRecommendationCard
   */
  saved: boolean
  /**
   *
   * @type {AdvisorRecommendationCardSponsored}
   * @memberof AdvisorRecommendationCard
   */
  sponsored: AdvisorRecommendationCardSponsored
}

/**
 * @export
 */
export const AdvisorRecommendationCardSlotEnum = {
  foundation: 'foundation',
  blush: 'blush',
  jewelry: 'jewelry',
  bag: 'bag',
  eyewear: 'eyewear',
} as const
export type AdvisorRecommendationCardSlotEnum =
  (typeof AdvisorRecommendationCardSlotEnum)[keyof typeof AdvisorRecommendationCardSlotEnum]

/**
 *
 * @export
 * @interface AdvisorRecommendationCardSponsored
 */
export interface AdvisorRecommendationCardSponsored {
  /**
   * CommercePartner.slug. Stable, safe to log.
   * @type {string}
   * @memberof AdvisorRecommendationCardSponsored
   */
  partnerId: string
  /**
   *
   * @type {string}
   * @memberof AdvisorRecommendationCardSponsored
   */
  partnerDisplayName: string
  /**
   * Pass back to POST /api/v1/commerce/affiliate/clicks with surface: "palette_advisor".
   * @type {string}
   * @memberof AdvisorRecommendationCardSponsored
   */
  offerId: string
  /**
   *
   * @type {string}
   * @memberof AdvisorRecommendationCardSponsored
   */
  offerTitle: string
}

/**
 *
 * @export
 */
export const AdvisorSlot = {
  foundation: 'foundation',
  blush: 'blush',
  jewelry: 'jewelry',
  bag: 'bag',
  eyewear: 'eyewear',
} as const
export type AdvisorSlot = (typeof AdvisorSlot)[keyof typeof AdvisorSlot]

/**
 *
 * @export
 * @interface AdvisorSponsoredOffer
 */
export interface AdvisorSponsoredOffer {
  /**
   * CommercePartner.slug. Stable, safe to log.
   * @type {string}
   * @memberof AdvisorSponsoredOffer
   */
  partnerId: string
  /**
   *
   * @type {string}
   * @memberof AdvisorSponsoredOffer
   */
  partnerDisplayName: string
  /**
   * Pass back to POST /api/v1/commerce/affiliate/clicks with surface: "palette_advisor".
   * @type {string}
   * @memberof AdvisorSponsoredOffer
   */
  offerId: string
  /**
   *
   * @type {string}
   * @memberof AdvisorSponsoredOffer
   */
  offerTitle: string
}
/**
 *
 * @export
 * @interface AffiliateClickRequest
 */
export interface AffiliateClickRequest {
  /**
   * The offerId returned in the ritual response shopThisLook block, or in a palette advisor recommendation card.
   * @type {string}
   * @memberof AffiliateClickRequest
   */
  offerId: string
  /**
   * The ScenarioOutfit.id the CTA was rendered on, or the PaletteProfile.id for an advisor click.
   * @type {string}
   * @memberof AffiliateClickRequest
   */
  recommendationId: string
  /**
   * Where the CTA was activated.
   * @type {AffiliateClickRequestSurfaceEnum}
   * @memberof AffiliateClickRequest
   */
  surface: AffiliateClickRequestSurfaceEnum
  /**
   * Which client activated the click. Read only for an advisor offer.
   * @type {AffiliateClickRequestPlatformEnum}
   * @memberof AffiliateClickRequest
   */
  platform?: AffiliateClickRequestPlatformEnum
}

/**
 * @export
 */
export const AffiliateClickRequestSurfaceEnum = {
  mobile_hero: 'mobile_hero',
  palette_advisor: 'palette_advisor',
} as const
export type AffiliateClickRequestSurfaceEnum =
  (typeof AffiliateClickRequestSurfaceEnum)[keyof typeof AffiliateClickRequestSurfaceEnum]

/**
 * @export
 */
export const AffiliateClickRequestPlatformEnum = {
  web: 'web',
  mobile: 'mobile',
} as const
export type AffiliateClickRequestPlatformEnum =
  (typeof AffiliateClickRequestPlatformEnum)[keyof typeof AffiliateClickRequestPlatformEnum]

/**
 *
 * @export
 * @interface AffiliateClickResponse
 */
export interface AffiliateClickResponse {
  /**
   *
   * @type {AffiliateClickResponseData}
   * @memberof AffiliateClickResponse
   */
  data: AffiliateClickResponseData
}
/**
 *
 * @export
 * @interface AffiliateClickResponseData
 */
export interface AffiliateClickResponseData {
  /**
   * Absolute https URL on the partner host, with the click token substituted. Built server-side; never cached by the client.
   * @type {string}
   * @memberof AffiliateClickResponseData
   */
  redirectUrl: string
}

/**
 *
 * @export
 */
export const AffiliateConversionStatus = {
  pending: 'pending',
  confirmed: 'confirmed',
  reversed: 'reversed',
} as const
export type AffiliateConversionStatus =
  (typeof AffiliateConversionStatus)[keyof typeof AffiliateConversionStatus]

/**
 *
 * @export
 */
export const AffiliateSurface = {
  mobile_hero: 'mobile_hero',
  palette_advisor: 'palette_advisor',
} as const
export type AffiliateSurface = (typeof AffiliateSurface)[keyof typeof AffiliateSurface]

/**
 *
 * @export
 * @interface AffiliateWebhookPayload
 */
export interface AffiliateWebhookPayload {
  /**
   * Partner-side unique event id. Replays of the same id write nothing.
   * @type {string}
   * @memberof AffiliateWebhookPayload
   */
  eventId: string
  /**
   * The token issued at click time. An unknown token is still recorded, unattributed.
   * @type {string}
   * @memberof AffiliateWebhookPayload
   */
  clickToken: string
  /**
   * ISO 8601 UTC instant the conversion happened partner-side.
   * @type {string}
   * @memberof AffiliateWebhookPayload
   */
  occurredAt: string
  /**
   *
   * @type {AffiliateWebhookPayloadStatusEnum}
   * @memberof AffiliateWebhookPayload
   */
  status: AffiliateWebhookPayloadStatusEnum
  /**
   * Integer minor units. Floating-point money is prohibited.
   * @type {number}
   * @memberof AffiliateWebhookPayload
   */
  orderValueMinorUnits: number
  /**
   * ISO 4217 alpha-3, uppercase.
   * @type {string}
   * @memberof AffiliateWebhookPayload
   */
  currency: string
}

/**
 * @export
 */
export const AffiliateWebhookPayloadStatusEnum = {
  pending: 'pending',
  confirmed: 'confirmed',
  reversed: 'reversed',
} as const
export type AffiliateWebhookPayloadStatusEnum =
  (typeof AffiliateWebhookPayloadStatusEnum)[keyof typeof AffiliateWebhookPayloadStatusEnum]

/**
 *
 * @export
 * @interface AffiliateWebhookResponse
 */
export interface AffiliateWebhookResponse {
  /**
   *
   * @type {AffiliateWebhookResponseData}
   * @memberof AffiliateWebhookResponse
   */
  data: AffiliateWebhookResponseData
}
/**
 *
 * @export
 * @interface AffiliateWebhookResponseData
 */
export interface AffiliateWebhookResponseData {
  /**
   *
   * @type {AffiliateWebhookResponseDataReceivedEnum}
   * @memberof AffiliateWebhookResponseData
   */
  received: AffiliateWebhookResponseDataReceivedEnum
}

/**
 * @export
 */
export const AffiliateWebhookResponseDataReceivedEnum = {
  true: true,
} as const
export type AffiliateWebhookResponseDataReceivedEnum =
  (typeof AffiliateWebhookResponseDataReceivedEnum)[keyof typeof AffiliateWebhookResponseDataReceivedEnum]

/**
 * Cross-field invariant enforced at runtime and NOT expressible in this schema: when quietHoursEnabled is true, quietHoursStart and quietHoursEnd must differ. JSON Schema has no operator comparing two sibling properties, so this rule is only visible here and in the 400 returned when it is violated.
 * @export
 * @interface AlertPreferences
 */
export interface AlertPreferences {
  /**
   *
   * @type {boolean}
   * @memberof AlertPreferences
   */
  quietHoursEnabled: boolean
  /**
   *
   * @type {boolean}
   * @memberof AlertPreferences
   */
  pushEnabled: boolean
  /**
   *
   * @type {string}
   * @memberof AlertPreferences
   */
  quietHoursStart: string
  /**
   *
   * @type {string}
   * @memberof AlertPreferences
   */
  quietHoursEnd: string
  /**
   * Invariant enforced at runtime and NOT expressible in this schema: the value must be a valid IANA timezone name as resolved by the host Intl database (for example America/New_York). Any other bounded string is rejected.
   * @type {string}
   * @memberof AlertPreferences
   */
  timezone: string
}
/**
 * @type AlertRule
 *
 * @export
 */
export type AlertRule = AlertRuleOneOf | AlertRuleOneOf1 | AlertRuleOneOf2
/**
 *
 * @export
 * @interface AlertRuleOneOf
 */
export interface AlertRuleOneOf {
  /**
   *
   * @type {AlertRuleOneOfRuleTypeEnum}
   * @memberof AlertRuleOneOf
   */
  ruleType: AlertRuleOneOfRuleTypeEnum
  /**
   *
   * @type {number}
   * @memberof AlertRuleOneOf
   */
  threshold: number
  /**
   *
   * @type {boolean}
   * @memberof AlertRuleOneOf
   */
  enabled: boolean
}

/**
 * @export
 */
export const AlertRuleOneOfRuleTypeEnum = {
  temperature: 'temperature',
} as const
export type AlertRuleOneOfRuleTypeEnum =
  (typeof AlertRuleOneOfRuleTypeEnum)[keyof typeof AlertRuleOneOfRuleTypeEnum]

/**
 *
 * @export
 * @interface AlertRuleOneOf1
 */
export interface AlertRuleOneOf1 {
  /**
   *
   * @type {AlertRuleOneOf1RuleTypeEnum}
   * @memberof AlertRuleOneOf1
   */
  ruleType: AlertRuleOneOf1RuleTypeEnum
  /**
   *
   * @type {number}
   * @memberof AlertRuleOneOf1
   */
  threshold: number
  /**
   *
   * @type {boolean}
   * @memberof AlertRuleOneOf1
   */
  enabled: boolean
}

/**
 * @export
 */
export const AlertRuleOneOf1RuleTypeEnum = {
  precipitation: 'precipitation',
} as const
export type AlertRuleOneOf1RuleTypeEnum =
  (typeof AlertRuleOneOf1RuleTypeEnum)[keyof typeof AlertRuleOneOf1RuleTypeEnum]

/**
 *
 * @export
 * @interface AlertRuleOneOf2
 */
export interface AlertRuleOneOf2 {
  /**
   *
   * @type {AlertRuleOneOf2RuleTypeEnum}
   * @memberof AlertRuleOneOf2
   */
  ruleType: AlertRuleOneOf2RuleTypeEnum
  /**
   *
   * @type {number}
   * @memberof AlertRuleOneOf2
   */
  threshold: number
  /**
   *
   * @type {boolean}
   * @memberof AlertRuleOneOf2
   */
  enabled: boolean
}

/**
 * @export
 */
export const AlertRuleOneOf2RuleTypeEnum = {
  severe: 'severe',
} as const
export type AlertRuleOneOf2RuleTypeEnum =
  (typeof AlertRuleOneOf2RuleTypeEnum)[keyof typeof AlertRuleOneOf2RuleTypeEnum]

/**
 *
 * @export
 */
export const AlertRuleType = {
  temperature: 'temperature',
  precipitation: 'precipitation',
  severe: 'severe',
} as const
export type AlertRuleType = (typeof AlertRuleType)[keyof typeof AlertRuleType]

/**
 *
 * @export
 * @interface AnalyzePaletteInput
 */
export interface AnalyzePaletteInput {
  /**
   *
   * @type {AnalyzePaletteInputSourceEnum}
   * @memberof AnalyzePaletteInput
   */
  source: AnalyzePaletteInputSourceEnum
}

/**
 * @export
 */
export const AnalyzePaletteInputSourceEnum = {
  wardrobe: 'wardrobe',
} as const
export type AnalyzePaletteInputSourceEnum =
  (typeof AnalyzePaletteInputSourceEnum)[keyof typeof AnalyzePaletteInputSourceEnum]

/**
 *
 * @export
 * @interface AnalyzePaletteResponse
 */
export interface AnalyzePaletteResponse {
  /**
   *
   * @type {PaletteAdvisorProfileResponseData}
   * @memberof AnalyzePaletteResponse
   */
  data: PaletteAdvisorProfileResponseData
}
/**
 *
 * @export
 * @interface ApiError
 */
export interface ApiError {
  /**
   *
   * @type {string}
   * @memberof ApiError
   */
  error: string
}
/**
 *
 * @export
 * @interface ApiHealthGet200Response
 */
export interface ApiHealthGet200Response {
  /**
   *
   * @type {ApiHealthGet200ResponseStatusEnum}
   * @memberof ApiHealthGet200Response
   */
  status: ApiHealthGet200ResponseStatusEnum
  /**
   *
   * @type {ApiHealthGet200ResponseServiceEnum}
   * @memberof ApiHealthGet200Response
   */
  service: ApiHealthGet200ResponseServiceEnum
  /**
   *
   * @type {string}
   * @memberof ApiHealthGet200Response
   */
  environment: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthGet200Response
   */
  gitSha: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthGet200Response
   */
  gitBranch: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthGet200Response
   */
  deployUrl?: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthGet200Response
   */
  timestamp: string
}

/**
 * @export
 */
export const ApiHealthGet200ResponseStatusEnum = {
  ok: 'ok',
} as const
export type ApiHealthGet200ResponseStatusEnum =
  (typeof ApiHealthGet200ResponseStatusEnum)[keyof typeof ApiHealthGet200ResponseStatusEnum]

/**
 * @export
 */
export const ApiHealthGet200ResponseServiceEnum = {
  couturecast_api: 'couturecast-api',
} as const
export type ApiHealthGet200ResponseServiceEnum =
  (typeof ApiHealthGet200ResponseServiceEnum)[keyof typeof ApiHealthGet200ResponseServiceEnum]

/**
 *
 * @export
 * @interface ApiHealthResponse
 */
export interface ApiHealthResponse {
  /**
   *
   * @type {ApiHealthResponseStatusEnum}
   * @memberof ApiHealthResponse
   */
  status: ApiHealthResponseStatusEnum
  /**
   *
   * @type {ApiHealthResponseServiceEnum}
   * @memberof ApiHealthResponse
   */
  service: ApiHealthResponseServiceEnum
  /**
   *
   * @type {string}
   * @memberof ApiHealthResponse
   */
  environment: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthResponse
   */
  gitSha: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthResponse
   */
  gitBranch: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthResponse
   */
  deployUrl?: string
  /**
   *
   * @type {string}
   * @memberof ApiHealthResponse
   */
  timestamp: string
}

/**
 * @export
 */
export const ApiHealthResponseStatusEnum = {
  ok: 'ok',
} as const
export type ApiHealthResponseStatusEnum =
  (typeof ApiHealthResponseStatusEnum)[keyof typeof ApiHealthResponseStatusEnum]

/**
 * @export
 */
export const ApiHealthResponseServiceEnum = {
  couturecast_api: 'couturecast-api',
} as const
export type ApiHealthResponseServiceEnum =
  (typeof ApiHealthResponseServiceEnum)[keyof typeof ApiHealthResponseServiceEnum]

/**
 *
 * @export
 * @interface ApiV1HealthQueuesGet200Response
 */
export interface ApiV1HealthQueuesGet200Response {
  /**
   *
   * @type {ApiV1HealthQueuesGet200ResponseStatusEnum}
   * @memberof ApiV1HealthQueuesGet200Response
   */
  status: ApiV1HealthQueuesGet200ResponseStatusEnum
  /**
   *
   * @type {Array<string>}
   * @memberof ApiV1HealthQueuesGet200Response
   */
  queues: Array<string>
  /**
   *
   * @type {ApiV1HealthQueuesGet200ResponseMetrics}
   * @memberof ApiV1HealthQueuesGet200Response
   */
  metrics: ApiV1HealthQueuesGet200ResponseMetrics
}

/**
 * @export
 */
export const ApiV1HealthQueuesGet200ResponseStatusEnum = {
  ok: 'ok',
} as const
export type ApiV1HealthQueuesGet200ResponseStatusEnum =
  (typeof ApiV1HealthQueuesGet200ResponseStatusEnum)[keyof typeof ApiV1HealthQueuesGet200ResponseStatusEnum]

/**
 *
 * @export
 * @interface ApiV1HealthQueuesGet200ResponseMetrics
 */
export interface ApiV1HealthQueuesGet200ResponseMetrics {
  /**
   *
   * @type {number}
   * @memberof ApiV1HealthQueuesGet200ResponseMetrics
   */
  waiting?: number
  /**
   *
   * @type {number}
   * @memberof ApiV1HealthQueuesGet200ResponseMetrics
   */
  active?: number
  /**
   *
   * @type {number}
   * @memberof ApiV1HealthQueuesGet200ResponseMetrics
   */
  completed?: number
  /**
   *
   * @type {number}
   * @memberof ApiV1HealthQueuesGet200ResponseMetrics
   */
  failed?: number
  /**
   *
   * @type {number}
   * @memberof ApiV1HealthQueuesGet200ResponseMetrics
   */
  delayed?: number
  /**
   *
   * @type {number}
   * @memberof ApiV1HealthQueuesGet200ResponseMetrics
   */
  paused?: number
}
/**
 *
 * @export
 * @interface BadRequestHttpError
 */
export interface BadRequestHttpError {
  /**
   *
   * @type {BadRequestHttpErrorStatusCodeEnum}
   * @memberof BadRequestHttpError
   */
  statusCode: BadRequestHttpErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof BadRequestHttpError
   */
  message: string
  /**
   *
   * @type {BadRequestHttpErrorErrorEnum}
   * @memberof BadRequestHttpError
   */
  error: BadRequestHttpErrorErrorEnum
}

/**
 * @export
 */
export const BadRequestHttpErrorStatusCodeEnum = {
  NUMBER_400: 400,
} as const
export type BadRequestHttpErrorStatusCodeEnum =
  (typeof BadRequestHttpErrorStatusCodeEnum)[keyof typeof BadRequestHttpErrorStatusCodeEnum]

/**
 * @export
 */
export const BadRequestHttpErrorErrorEnum = {
  Bad_Request: 'Bad Request',
} as const
export type BadRequestHttpErrorErrorEnum =
  (typeof BadRequestHttpErrorErrorEnum)[keyof typeof BadRequestHttpErrorErrorEnum]

/**
 *
 * @export
 * @interface BillingWebhookResponse
 */
export interface BillingWebhookResponse {
  /**
   *
   * @type {AffiliateWebhookResponseData}
   * @memberof BillingWebhookResponse
   */
  data: AffiliateWebhookResponseData
}
/**
 *
 * @export
 * @interface CapsuleBadRequestError
 */
export interface CapsuleBadRequestError {
  /**
   *
   * @type {CapsuleBadRequestErrorStatusCodeEnum}
   * @memberof CapsuleBadRequestError
   */
  statusCode: CapsuleBadRequestErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof CapsuleBadRequestError
   */
  message: string
  /**
   *
   * @type {CapsuleBadRequestErrorErrorEnum}
   * @memberof CapsuleBadRequestError
   */
  error: CapsuleBadRequestErrorErrorEnum
}

/**
 * @export
 */
export const CapsuleBadRequestErrorStatusCodeEnum = {
  NUMBER_400: 400,
} as const
export type CapsuleBadRequestErrorStatusCodeEnum =
  (typeof CapsuleBadRequestErrorStatusCodeEnum)[keyof typeof CapsuleBadRequestErrorStatusCodeEnum]

/**
 * @export
 */
export const CapsuleBadRequestErrorErrorEnum = {
  Bad_Request: 'Bad Request',
} as const
export type CapsuleBadRequestErrorErrorEnum =
  (typeof CapsuleBadRequestErrorErrorEnum)[keyof typeof CapsuleBadRequestErrorErrorEnum]

/**
 *
 * @export
 * @interface CapsuleConflictError
 */
export interface CapsuleConflictError {
  /**
   *
   * @type {CapsuleConflictErrorStatusCodeEnum}
   * @memberof CapsuleConflictError
   */
  statusCode: CapsuleConflictErrorStatusCodeEnum
  /**
   *
   * @type {CapsuleConflictErrorMessageEnum}
   * @memberof CapsuleConflictError
   */
  message: CapsuleConflictErrorMessageEnum
  /**
   *
   * @type {CapsuleConflictErrorErrorEnum}
   * @memberof CapsuleConflictError
   */
  error: CapsuleConflictErrorErrorEnum
}

/**
 * @export
 */
export const CapsuleConflictErrorStatusCodeEnum = {
  NUMBER_409: 409,
} as const
export type CapsuleConflictErrorStatusCodeEnum =
  (typeof CapsuleConflictErrorStatusCodeEnum)[keyof typeof CapsuleConflictErrorStatusCodeEnum]

/**
 * @export
 */
export const CapsuleConflictErrorMessageEnum = {
  GARMENT_NOT_CAPSULE_ELIGIBLE: 'GARMENT_NOT_CAPSULE_ELIGIBLE',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
} as const
export type CapsuleConflictErrorMessageEnum =
  (typeof CapsuleConflictErrorMessageEnum)[keyof typeof CapsuleConflictErrorMessageEnum]

/**
 * @export
 */
export const CapsuleConflictErrorErrorEnum = {
  Conflict: 'Conflict',
} as const
export type CapsuleConflictErrorErrorEnum =
  (typeof CapsuleConflictErrorErrorEnum)[keyof typeof CapsuleConflictErrorErrorEnum]

/**
 *
 * @export
 * @interface CapsuleForbiddenError
 */
export interface CapsuleForbiddenError {
  /**
   *
   * @type {CapsuleForbiddenErrorStatusCodeEnum}
   * @memberof CapsuleForbiddenError
   */
  statusCode: CapsuleForbiddenErrorStatusCodeEnum
  /**
   *
   * @type {CapsuleForbiddenErrorMessageEnum}
   * @memberof CapsuleForbiddenError
   */
  message: CapsuleForbiddenErrorMessageEnum
  /**
   *
   * @type {CapsuleForbiddenErrorErrorEnum}
   * @memberof CapsuleForbiddenError
   */
  error: CapsuleForbiddenErrorErrorEnum
}

/**
 * @export
 */
export const CapsuleForbiddenErrorStatusCodeEnum = {
  NUMBER_403: 403,
} as const
export type CapsuleForbiddenErrorStatusCodeEnum =
  (typeof CapsuleForbiddenErrorStatusCodeEnum)[keyof typeof CapsuleForbiddenErrorStatusCodeEnum]

/**
 * @export
 */
export const CapsuleForbiddenErrorMessageEnum = {
  GUARDIAN_READ_ONLY: 'GUARDIAN_READ_ONLY',
  GUARDIAN_CONSENT_REQUIRED: 'GUARDIAN_CONSENT_REQUIRED',
} as const
export type CapsuleForbiddenErrorMessageEnum =
  (typeof CapsuleForbiddenErrorMessageEnum)[keyof typeof CapsuleForbiddenErrorMessageEnum]

/**
 * @export
 */
export const CapsuleForbiddenErrorErrorEnum = {
  Forbidden: 'Forbidden',
} as const
export type CapsuleForbiddenErrorErrorEnum =
  (typeof CapsuleForbiddenErrorErrorEnum)[keyof typeof CapsuleForbiddenErrorErrorEnum]

/**
 *
 * @export
 * @interface CapsuleNotFoundError
 */
export interface CapsuleNotFoundError {
  /**
   *
   * @type {CapsuleNotFoundErrorStatusCodeEnum}
   * @memberof CapsuleNotFoundError
   */
  statusCode: CapsuleNotFoundErrorStatusCodeEnum
  /**
   *
   * @type {CapsuleNotFoundErrorMessageEnum}
   * @memberof CapsuleNotFoundError
   */
  message: CapsuleNotFoundErrorMessageEnum
  /**
   *
   * @type {CapsuleNotFoundErrorErrorEnum}
   * @memberof CapsuleNotFoundError
   */
  error: CapsuleNotFoundErrorErrorEnum
}

/**
 * @export
 */
export const CapsuleNotFoundErrorStatusCodeEnum = {
  NUMBER_404: 404,
} as const
export type CapsuleNotFoundErrorStatusCodeEnum =
  (typeof CapsuleNotFoundErrorStatusCodeEnum)[keyof typeof CapsuleNotFoundErrorStatusCodeEnum]

/**
 * @export
 */
export const CapsuleNotFoundErrorMessageEnum = {
  NOT_FOUND: 'NOT_FOUND',
} as const
export type CapsuleNotFoundErrorMessageEnum =
  (typeof CapsuleNotFoundErrorMessageEnum)[keyof typeof CapsuleNotFoundErrorMessageEnum]

/**
 * @export
 */
export const CapsuleNotFoundErrorErrorEnum = {
  Not_Found: 'Not Found',
} as const
export type CapsuleNotFoundErrorErrorEnum =
  (typeof CapsuleNotFoundErrorErrorEnum)[keyof typeof CapsuleNotFoundErrorErrorEnum]

/**
 *
 * @export
 * @interface CapsulePreconditionFailedError
 */
export interface CapsulePreconditionFailedError {
  /**
   *
   * @type {CapsulePreconditionFailedErrorStatusCodeEnum}
   * @memberof CapsulePreconditionFailedError
   */
  statusCode: CapsulePreconditionFailedErrorStatusCodeEnum
  /**
   *
   * @type {CapsulePreconditionFailedErrorMessageEnum}
   * @memberof CapsulePreconditionFailedError
   */
  message: CapsulePreconditionFailedErrorMessageEnum
  /**
   *
   * @type {CapsulePreconditionFailedErrorErrorEnum}
   * @memberof CapsulePreconditionFailedError
   */
  error: CapsulePreconditionFailedErrorErrorEnum
}

/**
 * @export
 */
export const CapsulePreconditionFailedErrorStatusCodeEnum = {
  NUMBER_412: 412,
} as const
export type CapsulePreconditionFailedErrorStatusCodeEnum =
  (typeof CapsulePreconditionFailedErrorStatusCodeEnum)[keyof typeof CapsulePreconditionFailedErrorStatusCodeEnum]

/**
 * @export
 */
export const CapsulePreconditionFailedErrorMessageEnum = {
  CAPSULE_REVISION_MISMATCH: 'CAPSULE_REVISION_MISMATCH',
} as const
export type CapsulePreconditionFailedErrorMessageEnum =
  (typeof CapsulePreconditionFailedErrorMessageEnum)[keyof typeof CapsulePreconditionFailedErrorMessageEnum]

/**
 * @export
 */
export const CapsulePreconditionFailedErrorErrorEnum = {
  Precondition_Failed: 'Precondition Failed',
} as const
export type CapsulePreconditionFailedErrorErrorEnum =
  (typeof CapsulePreconditionFailedErrorErrorEnum)[keyof typeof CapsulePreconditionFailedErrorErrorEnum]

/**
 *
 * @export
 * @interface CapsulePreconditionRequiredError
 */
export interface CapsulePreconditionRequiredError {
  /**
   *
   * @type {CapsulePreconditionRequiredErrorStatusCodeEnum}
   * @memberof CapsulePreconditionRequiredError
   */
  statusCode: CapsulePreconditionRequiredErrorStatusCodeEnum
  /**
   *
   * @type {CapsulePreconditionRequiredErrorMessageEnum}
   * @memberof CapsulePreconditionRequiredError
   */
  message: CapsulePreconditionRequiredErrorMessageEnum
  /**
   *
   * @type {CapsulePreconditionRequiredErrorErrorEnum}
   * @memberof CapsulePreconditionRequiredError
   */
  error: CapsulePreconditionRequiredErrorErrorEnum
}

/**
 * @export
 */
export const CapsulePreconditionRequiredErrorStatusCodeEnum = {
  NUMBER_428: 428,
} as const
export type CapsulePreconditionRequiredErrorStatusCodeEnum =
  (typeof CapsulePreconditionRequiredErrorStatusCodeEnum)[keyof typeof CapsulePreconditionRequiredErrorStatusCodeEnum]

/**
 * @export
 */
export const CapsulePreconditionRequiredErrorMessageEnum = {
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
} as const
export type CapsulePreconditionRequiredErrorMessageEnum =
  (typeof CapsulePreconditionRequiredErrorMessageEnum)[keyof typeof CapsulePreconditionRequiredErrorMessageEnum]

/**
 * @export
 */
export const CapsulePreconditionRequiredErrorErrorEnum = {
  Precondition_Required: 'Precondition Required',
} as const
export type CapsulePreconditionRequiredErrorErrorEnum =
  (typeof CapsulePreconditionRequiredErrorErrorEnum)[keyof typeof CapsulePreconditionRequiredErrorErrorEnum]

/**
 *
 * @export
 * @interface CheckoutSessionRequest
 */
export interface CheckoutSessionRequest {
  /**
   * Which Stripe price the session is for.
   * @type {CheckoutSessionRequestPlanEnum}
   * @memberof CheckoutSessionRequest
   */
  plan: CheckoutSessionRequestPlanEnum
}

/**
 * @export
 */
export const CheckoutSessionRequestPlanEnum = {
  premium_monthly: 'premium_monthly',
  premium_annual: 'premium_annual',
} as const
export type CheckoutSessionRequestPlanEnum =
  (typeof CheckoutSessionRequestPlanEnum)[keyof typeof CheckoutSessionRequestPlanEnum]

/**
 *
 * @export
 * @interface CheckoutSessionResponse
 */
export interface CheckoutSessionResponse {
  /**
   *
   * @type {CheckoutSessionResponseData}
   * @memberof CheckoutSessionResponse
   */
  data: CheckoutSessionResponseData
}
/**
 *
 * @export
 * @interface CheckoutSessionResponseData
 */
export interface CheckoutSessionResponseData {
  /**
   * Stripe-hosted Checkout URL. The web app redirects with window.location.assign; no Stripe dependency exists client-side.
   * @type {string}
   * @memberof CheckoutSessionResponseData
   */
  url: string
}
/**
 *
 * @export
 * @interface ComfortPreferences
 */
export interface ComfortPreferences {
  /**
   *
   * @type {ComfortPreferencesRunsColdWarmEnum}
   * @memberof ComfortPreferences
   */
  runsColdWarm: ComfortPreferencesRunsColdWarmEnum
  /**
   *
   * @type {ComfortPreferencesWindToleranceEnum}
   * @memberof ComfortPreferences
   */
  windTolerance: ComfortPreferencesWindToleranceEnum
  /**
   *
   * @type {ComfortPreferencesPrecipPreparednessEnum}
   * @memberof ComfortPreferences
   */
  precipPreparedness: ComfortPreferencesPrecipPreparednessEnum
}

/**
 * @export
 */
export const ComfortPreferencesRunsColdWarmEnum = {
  cold: 'cold',
  neutral: 'neutral',
  warm: 'warm',
} as const
export type ComfortPreferencesRunsColdWarmEnum =
  (typeof ComfortPreferencesRunsColdWarmEnum)[keyof typeof ComfortPreferencesRunsColdWarmEnum]

/**
 * @export
 */
export const ComfortPreferencesWindToleranceEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type ComfortPreferencesWindToleranceEnum =
  (typeof ComfortPreferencesWindToleranceEnum)[keyof typeof ComfortPreferencesWindToleranceEnum]

/**
 * @export
 */
export const ComfortPreferencesPrecipPreparednessEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type ComfortPreferencesPrecipPreparednessEnum =
  (typeof ComfortPreferencesPrecipPreparednessEnum)[keyof typeof ComfortPreferencesPrecipPreparednessEnum]

/**
 *
 * @export
 * @interface ComfortPreferencesResponse
 */
export interface ComfortPreferencesResponse {
  /**
   *
   * @type {ComfortPreferencesResponseData}
   * @memberof ComfortPreferencesResponse
   */
  data: ComfortPreferencesResponseData
}
/**
 *
 * @export
 * @interface ComfortPreferencesResponseData
 */
export interface ComfortPreferencesResponseData {
  /**
   *
   * @type {ComfortPreferencesResponseDataRunsColdWarmEnum}
   * @memberof ComfortPreferencesResponseData
   */
  runsColdWarm: ComfortPreferencesResponseDataRunsColdWarmEnum
  /**
   *
   * @type {ComfortPreferencesResponseDataWindToleranceEnum}
   * @memberof ComfortPreferencesResponseData
   */
  windTolerance: ComfortPreferencesResponseDataWindToleranceEnum
  /**
   *
   * @type {ComfortPreferencesResponseDataPrecipPreparednessEnum}
   * @memberof ComfortPreferencesResponseData
   */
  precipPreparedness: ComfortPreferencesResponseDataPrecipPreparednessEnum
}

/**
 * @export
 */
export const ComfortPreferencesResponseDataRunsColdWarmEnum = {
  cold: 'cold',
  neutral: 'neutral',
  warm: 'warm',
} as const
export type ComfortPreferencesResponseDataRunsColdWarmEnum =
  (typeof ComfortPreferencesResponseDataRunsColdWarmEnum)[keyof typeof ComfortPreferencesResponseDataRunsColdWarmEnum]

/**
 * @export
 */
export const ComfortPreferencesResponseDataWindToleranceEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type ComfortPreferencesResponseDataWindToleranceEnum =
  (typeof ComfortPreferencesResponseDataWindToleranceEnum)[keyof typeof ComfortPreferencesResponseDataWindToleranceEnum]

/**
 * @export
 */
export const ComfortPreferencesResponseDataPrecipPreparednessEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type ComfortPreferencesResponseDataPrecipPreparednessEnum =
  (typeof ComfortPreferencesResponseDataPrecipPreparednessEnum)[keyof typeof ComfortPreferencesResponseDataPrecipPreparednessEnum]

/**
 *
 * @export
 */
export const ComfortRun = {
  cold: 'cold',
  neutral: 'neutral',
  warm: 'warm',
} as const
export type ComfortRun = (typeof ComfortRun)[keyof typeof ComfortRun]

/**
 *
 * @export
 * @interface CommercePreference
 */
export interface CommercePreference {
  /**
   * False hides every affiliate CTA. Defaults true; a user with no stored row reads as true.
   * @type {boolean}
   * @memberof CommercePreference
   */
  affiliateCtasEnabled: boolean
}
/**
 *
 * @export
 * @interface CommercePreferenceResponse
 */
export interface CommercePreferenceResponse {
  /**
   *
   * @type {CommercePreferenceResponseData}
   * @memberof CommercePreferenceResponse
   */
  data: CommercePreferenceResponseData
}
/**
 *
 * @export
 * @interface CommercePreferenceResponseData
 */
export interface CommercePreferenceResponseData {
  /**
   * False hides every affiliate CTA. Defaults true; a user with no stored row reads as true.
   * @type {boolean}
   * @memberof CommercePreferenceResponseData
   */
  affiliateCtasEnabled: boolean
}
/**
 *
 * @export
 * @interface CommitPaletteSelfieInput
 */
export interface CommitPaletteSelfieInput {
  /**
   *
   * @type {string}
   * @memberof CommitPaletteSelfieInput
   */
  uploadSessionId: string
}
/**
 *
 * @export
 * @interface CommitPaletteSelfieResponse
 */
export interface CommitPaletteSelfieResponse {
  /**
   *
   * @type {PaletteAdvisorProfileResponseData}
   * @memberof CommitPaletteSelfieResponse
   */
  data: PaletteAdvisorProfileResponseData
}
/**
 *
 * @export
 * @interface CommitSilhouettePhotoInput
 */
export interface CommitSilhouettePhotoInput {
  /**
   *
   * @type {string}
   * @memberof CommitSilhouettePhotoInput
   */
  uploadSessionId: string
  /**
   *
   * @type {CommitSilhouettePhotoInputConfirmsBasewearGuidanceEnum}
   * @memberof CommitSilhouettePhotoInput
   */
  confirmsBasewearGuidance: CommitSilhouettePhotoInputConfirmsBasewearGuidanceEnum
}

/**
 * @export
 */
export const CommitSilhouettePhotoInputConfirmsBasewearGuidanceEnum = {
  true: true,
} as const
export type CommitSilhouettePhotoInputConfirmsBasewearGuidanceEnum =
  (typeof CommitSilhouettePhotoInputConfirmsBasewearGuidanceEnum)[keyof typeof CommitSilhouettePhotoInputConfirmsBasewearGuidanceEnum]

/**
 *
 * @export
 * @interface ConflictHttpError
 */
export interface ConflictHttpError {
  /**
   *
   * @type {ConflictHttpErrorStatusCodeEnum}
   * @memberof ConflictHttpError
   */
  statusCode: ConflictHttpErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof ConflictHttpError
   */
  message: string
  /**
   *
   * @type {ConflictHttpErrorErrorEnum}
   * @memberof ConflictHttpError
   */
  error: ConflictHttpErrorErrorEnum
}

/**
 * @export
 */
export const ConflictHttpErrorStatusCodeEnum = {
  NUMBER_409: 409,
} as const
export type ConflictHttpErrorStatusCodeEnum =
  (typeof ConflictHttpErrorStatusCodeEnum)[keyof typeof ConflictHttpErrorStatusCodeEnum]

/**
 * @export
 */
export const ConflictHttpErrorErrorEnum = {
  Conflict: 'Conflict',
} as const
export type ConflictHttpErrorErrorEnum =
  (typeof ConflictHttpErrorErrorEnum)[keyof typeof ConflictHttpErrorErrorEnum]

/**
 *
 * @export
 * @interface CreateGarmentItemInput
 */
export interface CreateGarmentItemInput {
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemInput
   */
  garmentId: string
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemInput
   */
  uploadSessionId: string
  /**
   *
   * @type {boolean}
   * @memberof CreateGarmentItemInput
   */
  hasCropping: boolean
  /**
   *
   * @type {boolean}
   * @memberof CreateGarmentItemInput
   */
  hasBgCleanup: boolean
}
/**
 *
 * @export
 * @interface CreateGarmentItemResponse
 */
export interface CreateGarmentItemResponse {
  /**
   *
   * @type {CreateGarmentItemResponseData}
   * @memberof CreateGarmentItemResponse
   */
  data: CreateGarmentItemResponseData
}
/**
 *
 * @export
 * @interface CreateGarmentItemResponseData
 */
export interface CreateGarmentItemResponseData {
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemResponseData
   */
  id: string
  /**
   * Open set. New lifecycle states are added as the tagging and moderation pipeline evolves, and this property is intentionally exempt from breaking-change enforcement for enum values. Treat an unrecognized status as pass-through rather than an error, and do not exhaustively switch on it without a default branch.
   * @type {CreateGarmentItemResponseDataStatusEnum}
   * @memberof CreateGarmentItemResponseData
   */
  status: CreateGarmentItemResponseDataStatusEnum
  /**
   *
   * @type {CreateGarmentItemResponseDataCategoryEnum}
   * @memberof CreateGarmentItemResponseData
   */
  category: CreateGarmentItemResponseDataCategoryEnum | null
  /**
   *
   * @type {CreateGarmentItemResponseDataMaterialEnum}
   * @memberof CreateGarmentItemResponseData
   */
  material: CreateGarmentItemResponseDataMaterialEnum | null
  /**
   *
   * @type {CreateGarmentItemResponseDataComfortRangeEnum}
   * @memberof CreateGarmentItemResponseData
   */
  comfortRange: CreateGarmentItemResponseDataComfortRangeEnum | null
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemResponseData
   */
  tagsConfirmedAt: string | null
  /**
   *
   * @type {number}
   * @memberof CreateGarmentItemResponseData
   */
  fileSizeBytes: number | null
  /**
   * Open set. Supported image formats track what the upload pipeline can decode and may gain values, so this property is intentionally exempt from breaking-change enforcement for enum values. Treat an unrecognized MIME type as pass-through rather than an error.
   * @type {CreateGarmentItemResponseDataMimeTypeEnum}
   * @memberof CreateGarmentItemResponseData
   */
  mimeType: CreateGarmentItemResponseDataMimeTypeEnum | null
  /**
   *
   * @type {CreateGarmentItemResponseDataRetentionStatusEnum}
   * @memberof CreateGarmentItemResponseData
   */
  retentionStatus: CreateGarmentItemResponseDataRetentionStatusEnum
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemResponseData
   */
  createdAt: string
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemResponseData
   */
  committedAt: string | null
  /**
   *
   * @type {CreateGarmentItemResponseDataImageAccess}
   * @memberof CreateGarmentItemResponseData
   */
  imageAccess: CreateGarmentItemResponseDataImageAccess
}

/**
 * @export
 */
export const CreateGarmentItemResponseDataStatusEnum = {
  pending_upload: 'pending_upload',
  bytes_uploaded: 'bytes_uploaded',
  processing: 'processing',
  awaiting_tags: 'awaiting_tags',
  ready: 'ready',
  failed: 'failed',
} as const
export type CreateGarmentItemResponseDataStatusEnum =
  (typeof CreateGarmentItemResponseDataStatusEnum)[keyof typeof CreateGarmentItemResponseDataStatusEnum]

/**
 * @export
 */
export const CreateGarmentItemResponseDataCategoryEnum = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  dress: 'dress',
  shoes: 'shoes',
  accessory: 'accessory',
} as const
export type CreateGarmentItemResponseDataCategoryEnum =
  (typeof CreateGarmentItemResponseDataCategoryEnum)[keyof typeof CreateGarmentItemResponseDataCategoryEnum]

/**
 * @export
 */
export const CreateGarmentItemResponseDataMaterialEnum = {
  cotton: 'cotton',
  wool: 'wool',
  linen: 'linen',
  leather: 'leather',
  denim: 'denim',
  fleece: 'fleece',
  synthetic: 'synthetic',
  down: 'down',
  silk: 'silk',
} as const
export type CreateGarmentItemResponseDataMaterialEnum =
  (typeof CreateGarmentItemResponseDataMaterialEnum)[keyof typeof CreateGarmentItemResponseDataMaterialEnum]

/**
 * @export
 */
export const CreateGarmentItemResponseDataComfortRangeEnum = {
  cold: 'cold',
  cool: 'cool',
  mild: 'mild',
  warm: 'warm',
  hot: 'hot',
} as const
export type CreateGarmentItemResponseDataComfortRangeEnum =
  (typeof CreateGarmentItemResponseDataComfortRangeEnum)[keyof typeof CreateGarmentItemResponseDataComfortRangeEnum]

/**
 * @export
 */
export const CreateGarmentItemResponseDataMimeTypeEnum = {
  image_jpeg: 'image/jpeg',
  image_png: 'image/png',
  image_webp: 'image/webp',
} as const
export type CreateGarmentItemResponseDataMimeTypeEnum =
  (typeof CreateGarmentItemResponseDataMimeTypeEnum)[keyof typeof CreateGarmentItemResponseDataMimeTypeEnum]

/**
 * @export
 */
export const CreateGarmentItemResponseDataRetentionStatusEnum = {
  active: 'active',
  deletion_pending: 'deletion_pending',
  legal_hold: 'legal_hold',
} as const
export type CreateGarmentItemResponseDataRetentionStatusEnum =
  (typeof CreateGarmentItemResponseDataRetentionStatusEnum)[keyof typeof CreateGarmentItemResponseDataRetentionStatusEnum]

/**
 *
 * @export
 * @interface CreateGarmentItemResponseDataImageAccess
 */
export interface CreateGarmentItemResponseDataImageAccess {
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemResponseDataImageAccess
   */
  url: string
  /**
   *
   * @type {string}
   * @memberof CreateGarmentItemResponseDataImageAccess
   */
  expiresAt: string
}
/**
 *
 * @export
 * @interface CreateGarmentUploadUrlInput
 */
export interface CreateGarmentUploadUrlInput {
  /**
   *
   * @type {number}
   * @memberof CreateGarmentUploadUrlInput
   */
  fileSizeBytes: number
  /**
   *
   * @type {CreateGarmentUploadUrlInputMimeTypeEnum}
   * @memberof CreateGarmentUploadUrlInput
   */
  mimeType: CreateGarmentUploadUrlInputMimeTypeEnum
  /**
   *
   * @type {string}
   * @memberof CreateGarmentUploadUrlInput
   */
  sha256: string
  /**
   *
   * @type {number}
   * @memberof CreateGarmentUploadUrlInput
   */
  widthPx: number
  /**
   *
   * @type {number}
   * @memberof CreateGarmentUploadUrlInput
   */
  heightPx: number
}

/**
 * @export
 */
export const CreateGarmentUploadUrlInputMimeTypeEnum = {
  image_jpeg: 'image/jpeg',
  image_png: 'image/png',
  image_webp: 'image/webp',
} as const
export type CreateGarmentUploadUrlInputMimeTypeEnum =
  (typeof CreateGarmentUploadUrlInputMimeTypeEnum)[keyof typeof CreateGarmentUploadUrlInputMimeTypeEnum]

/**
 *
 * @export
 * @interface CreateGarmentUploadUrlResponse
 */
export interface CreateGarmentUploadUrlResponse {
  /**
   *
   * @type {CreateGarmentUploadUrlResponseData}
   * @memberof CreateGarmentUploadUrlResponse
   */
  data: CreateGarmentUploadUrlResponseData
}
/**
 *
 * @export
 * @interface CreateGarmentUploadUrlResponseData
 */
export interface CreateGarmentUploadUrlResponseData {
  /**
   *
   * @type {string}
   * @memberof CreateGarmentUploadUrlResponseData
   */
  garmentId: string
  /**
   *
   * @type {string}
   * @memberof CreateGarmentUploadUrlResponseData
   */
  uploadSessionId: string
  /**
   *
   * @type {string}
   * @memberof CreateGarmentUploadUrlResponseData
   */
  uploadUrl: string
  /**
   *
   * @type {string}
   * @memberof CreateGarmentUploadUrlResponseData
   */
  uploadToken: string
  /**
   *
   * @type {CreateGarmentUploadUrlResponseDataRequiredHeaders}
   * @memberof CreateGarmentUploadUrlResponseData
   */
  requiredHeaders: CreateGarmentUploadUrlResponseDataRequiredHeaders
  /**
   *
   * @type {string}
   * @memberof CreateGarmentUploadUrlResponseData
   */
  expiresAt: string
}
/**
 *
 * @export
 * @interface CreateGarmentUploadUrlResponseDataRequiredHeaders
 */
export interface CreateGarmentUploadUrlResponseDataRequiredHeaders {
  /**
   *
   * @type {string}
   * @memberof CreateGarmentUploadUrlResponseDataRequiredHeaders
   */
  contentType: string
}
/**
 *
 * @export
 * @interface CreateOutfitCapsuleInput
 */
export interface CreateOutfitCapsuleInput {
  /**
   * Trimmed and NFC-normalized before validation, then bounded to 1-60 extended grapheme clusters (user-perceived characters), not UTF-16 code units. A JSON Schema maxLength cannot express this: an emoji with a skin-tone modifier counts as one here and as four code units there. null bytes are rejected because PostgreSQL text cannot store them.
   * @type {string}
   * @memberof CreateOutfitCapsuleInput
   */
  name: string
  /**
   * Trimmed and NFC-normalized before validation, then bounded to 0-280 extended grapheme clusters (user-perceived characters), not UTF-16 code units. A JSON Schema maxLength cannot express this: an emoji with a skin-tone modifier counts as one here and as four code units there. null bytes are rejected because PostgreSQL text cannot store them.
   * @type {string}
   * @memberof CreateOutfitCapsuleInput
   */
  description?: string | null
  /**
   *
   * @type {Array<CreateOutfitCapsuleInputOccasionsEnum>}
   * @memberof CreateOutfitCapsuleInput
   */
  occasions: Array<CreateOutfitCapsuleInputOccasionsEnum>
  /**
   * Collection invariant enforced at runtime and NOT expressible in this schema: garmentIds must contain no duplicates. JSON Schema uniqueItems would express this for a plain string array, but it is not emitted here, so the rule is only visible in this description and in the 400 returned when it is violated.
   * @type {Array<string>}
   * @memberof CreateOutfitCapsuleInput
   */
  garmentIds: Array<string>
  /**
   *
   * @type {boolean}
   * @memberof CreateOutfitCapsuleInput
   */
  isFavorite?: boolean
}

/**
 * @export
 */
export const CreateOutfitCapsuleInputOccasionsEnum = {
  work: 'work',
  casual: 'casual',
  formal: 'formal',
  sport: 'sport',
  travel: 'travel',
  evening: 'evening',
  outdoor: 'outdoor',
  home: 'home',
} as const
export type CreateOutfitCapsuleInputOccasionsEnum =
  (typeof CreateOutfitCapsuleInputOccasionsEnum)[keyof typeof CreateOutfitCapsuleInputOccasionsEnum]

/**
 *
 * @export
 * @interface CreatePaletteSelfieUploadUrlInput
 */
export interface CreatePaletteSelfieUploadUrlInput {
  /**
   *
   * @type {number}
   * @memberof CreatePaletteSelfieUploadUrlInput
   */
  fileSizeBytes: number
  /**
   *
   * @type {CreatePaletteSelfieUploadUrlInputMimeTypeEnum}
   * @memberof CreatePaletteSelfieUploadUrlInput
   */
  mimeType: CreatePaletteSelfieUploadUrlInputMimeTypeEnum
  /**
   *
   * @type {string}
   * @memberof CreatePaletteSelfieUploadUrlInput
   */
  sha256: string
  /**
   *
   * @type {number}
   * @memberof CreatePaletteSelfieUploadUrlInput
   */
  widthPx: number
  /**
   *
   * @type {number}
   * @memberof CreatePaletteSelfieUploadUrlInput
   */
  heightPx: number
}

/**
 * @export
 */
export const CreatePaletteSelfieUploadUrlInputMimeTypeEnum = {
  image_jpeg: 'image/jpeg',
  image_png: 'image/png',
  image_webp: 'image/webp',
} as const
export type CreatePaletteSelfieUploadUrlInputMimeTypeEnum =
  (typeof CreatePaletteSelfieUploadUrlInputMimeTypeEnum)[keyof typeof CreatePaletteSelfieUploadUrlInputMimeTypeEnum]

/**
 *
 * @export
 * @interface CreatePaletteSelfieUploadUrlResponse
 */
export interface CreatePaletteSelfieUploadUrlResponse {
  /**
   *
   * @type {CreateSilhouetteUploadUrlResponseData}
   * @memberof CreatePaletteSelfieUploadUrlResponse
   */
  data: CreateSilhouetteUploadUrlResponseData
}
/**
 *
 * @export
 * @interface CreateSavedLocationInput
 */
export interface CreateSavedLocationInput {
  /**
   *
   * @type {string}
   * @memberof CreateSavedLocationInput
   */
  label: string
  /**
   *
   * @type {string}
   * @memberof CreateSavedLocationInput
   */
  locationKey: string
  /**
   *
   * @type {number}
   * @memberof CreateSavedLocationInput
   */
  latitude: number
  /**
   *
   * @type {number}
   * @memberof CreateSavedLocationInput
   */
  longitude: number
  /**
   *
   * @type {string}
   * @memberof CreateSavedLocationInput
   */
  timezone: string
  /**
   *
   * @type {string}
   * @memberof CreateSavedLocationInput
   */
  city?: string
  /**
   *
   * @type {string}
   * @memberof CreateSavedLocationInput
   */
  region?: string
  /**
   *
   * @type {string}
   * @memberof CreateSavedLocationInput
   */
  country?: string
}
/**
 *
 * @export
 * @interface CreateSavedLocationResponse
 */
export interface CreateSavedLocationResponse {
  /**
   *
   * @type {ListSavedLocationsResponseDataInner}
   * @memberof CreateSavedLocationResponse
   */
  data: ListSavedLocationsResponseDataInner
}
/**
 *
 * @export
 * @interface CreateSilhouetteUploadUrlInput
 */
export interface CreateSilhouetteUploadUrlInput {
  /**
   *
   * @type {number}
   * @memberof CreateSilhouetteUploadUrlInput
   */
  fileSizeBytes: number
  /**
   *
   * @type {CreateSilhouetteUploadUrlInputMimeTypeEnum}
   * @memberof CreateSilhouetteUploadUrlInput
   */
  mimeType: CreateSilhouetteUploadUrlInputMimeTypeEnum
  /**
   *
   * @type {string}
   * @memberof CreateSilhouetteUploadUrlInput
   */
  sha256: string
  /**
   *
   * @type {number}
   * @memberof CreateSilhouetteUploadUrlInput
   */
  widthPx: number
  /**
   *
   * @type {number}
   * @memberof CreateSilhouetteUploadUrlInput
   */
  heightPx: number
}

/**
 * @export
 */
export const CreateSilhouetteUploadUrlInputMimeTypeEnum = {
  image_jpeg: 'image/jpeg',
  image_png: 'image/png',
  image_webp: 'image/webp',
} as const
export type CreateSilhouetteUploadUrlInputMimeTypeEnum =
  (typeof CreateSilhouetteUploadUrlInputMimeTypeEnum)[keyof typeof CreateSilhouetteUploadUrlInputMimeTypeEnum]

/**
 *
 * @export
 * @interface CreateSilhouetteUploadUrlResponse
 */
export interface CreateSilhouetteUploadUrlResponse {
  /**
   *
   * @type {CreateSilhouetteUploadUrlResponseData}
   * @memberof CreateSilhouetteUploadUrlResponse
   */
  data: CreateSilhouetteUploadUrlResponseData
}
/**
 *
 * @export
 * @interface CreateSilhouetteUploadUrlResponseData
 */
export interface CreateSilhouetteUploadUrlResponseData {
  /**
   *
   * @type {string}
   * @memberof CreateSilhouetteUploadUrlResponseData
   */
  uploadSessionId: string
  /**
   *
   * @type {string}
   * @memberof CreateSilhouetteUploadUrlResponseData
   */
  uploadUrl: string
  /**
   *
   * @type {string}
   * @memberof CreateSilhouetteUploadUrlResponseData
   */
  uploadToken: string
  /**
   *
   * @type {CreateGarmentUploadUrlResponseDataRequiredHeaders}
   * @memberof CreateSilhouetteUploadUrlResponseData
   */
  requiredHeaders: CreateGarmentUploadUrlResponseDataRequiredHeaders
  /**
   *
   * @type {string}
   * @memberof CreateSilhouetteUploadUrlResponseData
   */
  expiresAt: string
}
/**
 *
 * @export
 * @interface DeletePaletteAdvisorResponse
 */
export interface DeletePaletteAdvisorResponse {
  /**
   *
   * @type {PaletteAdvisorProfileResponseData}
   * @memberof DeletePaletteAdvisorResponse
   */
  data: PaletteAdvisorProfileResponseData
}
/**
 *
 * @export
 * @interface DeleteSavedLocationResponse
 */
export interface DeleteSavedLocationResponse {
  /**
   *
   * @type {DeleteSavedLocationResponseData}
   * @memberof DeleteSavedLocationResponse
   */
  data: DeleteSavedLocationResponseData
}
/**
 *
 * @export
 * @interface DeleteSavedLocationResponseData
 */
export interface DeleteSavedLocationResponseData {
  /**
   *
   * @type {DeleteSavedLocationResponseDataDeletedEnum}
   * @memberof DeleteSavedLocationResponseData
   */
  deleted: DeleteSavedLocationResponseDataDeletedEnum
}

/**
 * @export
 */
export const DeleteSavedLocationResponseDataDeletedEnum = {
  true: true,
} as const
export type DeleteSavedLocationResponseDataDeletedEnum =
  (typeof DeleteSavedLocationResponseDataDeletedEnum)[keyof typeof DeleteSavedLocationResponseDataDeletedEnum]

/**
 *
 * @export
 */
export const EntitlementStore = {
  app_store: 'app_store',
  play_store: 'play_store',
  stripe: 'stripe',
  promotional: 'promotional',
} as const
export type EntitlementStore = (typeof EntitlementStore)[keyof typeof EntitlementStore]

/**
 *
 * @export
 * @interface EventsPollInvalidSinceResponse
 */
export interface EventsPollInvalidSinceResponse {
  /**
   *
   * @type {Array<PolledEvent>}
   * @memberof EventsPollInvalidSinceResponse
   */
  events: Array<PolledEvent>
  /**
   *
   * @type {null}
   * @memberof EventsPollInvalidSinceResponse
   */
  nextSince: null
  /**
   *
   * @type {string}
   * @memberof EventsPollInvalidSinceResponse
   */
  error: string
}
/**
 *
 * @export
 * @interface EventsPollQuery
 */
export interface EventsPollQuery {
  /**
   * Fetch only events created after this ISO timestamp.
   * @type {string}
   * @memberof EventsPollQuery
   */
  since?: string
}
/**
 *
 * @export
 * @interface EventsPollResponse
 */
export interface EventsPollResponse {
  /**
   *
   * @type {Array<PolledEvent>}
   * @memberof EventsPollResponse
   */
  events: Array<PolledEvent>
  /**
   *
   * @type {string}
   * @memberof EventsPollResponse
   */
  nextSince: string | null
}
/**
 *
 * @export
 * @interface EventsPollResult
 */
export interface EventsPollResult {
  /**
   *
   * @type {Array<PolledEvent>}
   * @memberof EventsPollResult
   */
  events: Array<PolledEvent>
  /**
   *
   * @type {null}
   * @memberof EventsPollResult
   */
  nextSince: null
  /**
   *
   * @type {string}
   * @memberof EventsPollResult
   */
  error: string
}
/**
 *
 * @export
 * @interface FavoriteOutfitCapsuleInput
 */
export interface FavoriteOutfitCapsuleInput {
  /**
   *
   * @type {boolean}
   * @memberof FavoriteOutfitCapsuleInput
   */
  isFavorite: boolean
}
/**
 *
 * @export
 * @interface ForbiddenHttpError
 */
export interface ForbiddenHttpError {
  /**
   *
   * @type {ForbiddenHttpErrorStatusCodeEnum}
   * @memberof ForbiddenHttpError
   */
  statusCode: ForbiddenHttpErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof ForbiddenHttpError
   */
  message: string
  /**
   *
   * @type {ForbiddenHttpErrorErrorEnum}
   * @memberof ForbiddenHttpError
   */
  error: ForbiddenHttpErrorErrorEnum
}

/**
 * @export
 */
export const ForbiddenHttpErrorStatusCodeEnum = {
  NUMBER_403: 403,
} as const
export type ForbiddenHttpErrorStatusCodeEnum =
  (typeof ForbiddenHttpErrorStatusCodeEnum)[keyof typeof ForbiddenHttpErrorStatusCodeEnum]

/**
 * @export
 */
export const ForbiddenHttpErrorErrorEnum = {
  Forbidden: 'Forbidden',
} as const
export type ForbiddenHttpErrorErrorEnum =
  (typeof ForbiddenHttpErrorErrorEnum)[keyof typeof ForbiddenHttpErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentIdBadRequestError
 */
export interface GarmentIdBadRequestError {
  /**
   *
   * @type {GarmentIdBadRequestErrorStatusCodeEnum}
   * @memberof GarmentIdBadRequestError
   */
  statusCode: GarmentIdBadRequestErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof GarmentIdBadRequestError
   */
  message: string
  /**
   *
   * @type {GarmentIdBadRequestErrorErrorEnum}
   * @memberof GarmentIdBadRequestError
   */
  error: GarmentIdBadRequestErrorErrorEnum
}

/**
 * @export
 */
export const GarmentIdBadRequestErrorStatusCodeEnum = {
  NUMBER_400: 400,
} as const
export type GarmentIdBadRequestErrorStatusCodeEnum =
  (typeof GarmentIdBadRequestErrorStatusCodeEnum)[keyof typeof GarmentIdBadRequestErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentIdBadRequestErrorErrorEnum = {
  Bad_Request: 'Bad Request',
} as const
export type GarmentIdBadRequestErrorErrorEnum =
  (typeof GarmentIdBadRequestErrorErrorEnum)[keyof typeof GarmentIdBadRequestErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentListResponse
 */
export interface GarmentListResponse {
  /**
   *
   * @type {Array<CreateGarmentItemResponseData>}
   * @memberof GarmentListResponse
   */
  data: Array<CreateGarmentItemResponseData>
}
/**
 *
 * @export
 * @interface GarmentSuggestionConflictError
 */
export interface GarmentSuggestionConflictError {
  /**
   *
   * @type {GarmentSuggestionConflictErrorStatusCodeEnum}
   * @memberof GarmentSuggestionConflictError
   */
  statusCode: GarmentSuggestionConflictErrorStatusCodeEnum
  /**
   *
   * @type {GarmentSuggestionConflictErrorMessageEnum}
   * @memberof GarmentSuggestionConflictError
   */
  message: GarmentSuggestionConflictErrorMessageEnum
  /**
   *
   * @type {GarmentSuggestionConflictErrorErrorEnum}
   * @memberof GarmentSuggestionConflictError
   */
  error: GarmentSuggestionConflictErrorErrorEnum
}

/**
 * @export
 */
export const GarmentSuggestionConflictErrorStatusCodeEnum = {
  NUMBER_409: 409,
} as const
export type GarmentSuggestionConflictErrorStatusCodeEnum =
  (typeof GarmentSuggestionConflictErrorStatusCodeEnum)[keyof typeof GarmentSuggestionConflictErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentSuggestionConflictErrorMessageEnum = {
  GARMENT_ANALYSIS_PENDING: 'GARMENT_ANALYSIS_PENDING',
  GARMENT_NOT_TAGGABLE: 'GARMENT_NOT_TAGGABLE',
} as const
export type GarmentSuggestionConflictErrorMessageEnum =
  (typeof GarmentSuggestionConflictErrorMessageEnum)[keyof typeof GarmentSuggestionConflictErrorMessageEnum]

/**
 * @export
 */
export const GarmentSuggestionConflictErrorErrorEnum = {
  Conflict: 'Conflict',
} as const
export type GarmentSuggestionConflictErrorErrorEnum =
  (typeof GarmentSuggestionConflictErrorErrorEnum)[keyof typeof GarmentSuggestionConflictErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentTaggingForbiddenError
 */
export interface GarmentTaggingForbiddenError {
  /**
   *
   * @type {GarmentTaggingForbiddenErrorStatusCodeEnum}
   * @memberof GarmentTaggingForbiddenError
   */
  statusCode: GarmentTaggingForbiddenErrorStatusCodeEnum
  /**
   *
   * @type {GarmentTaggingForbiddenErrorMessageEnum}
   * @memberof GarmentTaggingForbiddenError
   */
  message: GarmentTaggingForbiddenErrorMessageEnum
  /**
   *
   * @type {GarmentTaggingForbiddenErrorErrorEnum}
   * @memberof GarmentTaggingForbiddenError
   */
  error: GarmentTaggingForbiddenErrorErrorEnum
}

/**
 * @export
 */
export const GarmentTaggingForbiddenErrorStatusCodeEnum = {
  NUMBER_403: 403,
} as const
export type GarmentTaggingForbiddenErrorStatusCodeEnum =
  (typeof GarmentTaggingForbiddenErrorStatusCodeEnum)[keyof typeof GarmentTaggingForbiddenErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentTaggingForbiddenErrorMessageEnum = {
  Guardian_consent_required_before_continuing:
    'Guardian consent required before continuing',
  GUARDIAN_CONSENT_REQUIRED: 'GUARDIAN_CONSENT_REQUIRED',
} as const
export type GarmentTaggingForbiddenErrorMessageEnum =
  (typeof GarmentTaggingForbiddenErrorMessageEnum)[keyof typeof GarmentTaggingForbiddenErrorMessageEnum]

/**
 * @export
 */
export const GarmentTaggingForbiddenErrorErrorEnum = {
  Forbidden: 'Forbidden',
} as const
export type GarmentTaggingForbiddenErrorErrorEnum =
  (typeof GarmentTaggingForbiddenErrorErrorEnum)[keyof typeof GarmentTaggingForbiddenErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentTaggingNotFoundError
 */
export interface GarmentTaggingNotFoundError {
  /**
   *
   * @type {GarmentTaggingNotFoundErrorStatusCodeEnum}
   * @memberof GarmentTaggingNotFoundError
   */
  statusCode: GarmentTaggingNotFoundErrorStatusCodeEnum
  /**
   *
   * @type {GarmentTaggingNotFoundErrorMessageEnum}
   * @memberof GarmentTaggingNotFoundError
   */
  message: GarmentTaggingNotFoundErrorMessageEnum
  /**
   *
   * @type {GarmentTaggingNotFoundErrorErrorEnum}
   * @memberof GarmentTaggingNotFoundError
   */
  error: GarmentTaggingNotFoundErrorErrorEnum
}

/**
 * @export
 */
export const GarmentTaggingNotFoundErrorStatusCodeEnum = {
  NUMBER_404: 404,
} as const
export type GarmentTaggingNotFoundErrorStatusCodeEnum =
  (typeof GarmentTaggingNotFoundErrorStatusCodeEnum)[keyof typeof GarmentTaggingNotFoundErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentTaggingNotFoundErrorMessageEnum = {
  GARMENT_NOT_FOUND: 'GARMENT_NOT_FOUND',
} as const
export type GarmentTaggingNotFoundErrorMessageEnum =
  (typeof GarmentTaggingNotFoundErrorMessageEnum)[keyof typeof GarmentTaggingNotFoundErrorMessageEnum]

/**
 * @export
 */
export const GarmentTaggingNotFoundErrorErrorEnum = {
  Not_Found: 'Not Found',
} as const
export type GarmentTaggingNotFoundErrorErrorEnum =
  (typeof GarmentTaggingNotFoundErrorErrorEnum)[keyof typeof GarmentTaggingNotFoundErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentTaggingUnauthorizedError
 */
export interface GarmentTaggingUnauthorizedError {
  /**
   *
   * @type {GarmentTaggingUnauthorizedErrorStatusCodeEnum}
   * @memberof GarmentTaggingUnauthorizedError
   */
  statusCode: GarmentTaggingUnauthorizedErrorStatusCodeEnum
  /**
   *
   * @type {GarmentTaggingUnauthorizedErrorMessageEnum}
   * @memberof GarmentTaggingUnauthorizedError
   */
  message: GarmentTaggingUnauthorizedErrorMessageEnum
  /**
   *
   * @type {GarmentTaggingUnauthorizedErrorErrorEnum}
   * @memberof GarmentTaggingUnauthorizedError
   */
  error: GarmentTaggingUnauthorizedErrorErrorEnum
}

/**
 * @export
 */
export const GarmentTaggingUnauthorizedErrorStatusCodeEnum = {
  NUMBER_401: 401,
} as const
export type GarmentTaggingUnauthorizedErrorStatusCodeEnum =
  (typeof GarmentTaggingUnauthorizedErrorStatusCodeEnum)[keyof typeof GarmentTaggingUnauthorizedErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentTaggingUnauthorizedErrorMessageEnum = {
  Missing_or_invalid_bearer_token: 'Missing or invalid bearer token',
  Invalid_access_token: 'Invalid access token',
} as const
export type GarmentTaggingUnauthorizedErrorMessageEnum =
  (typeof GarmentTaggingUnauthorizedErrorMessageEnum)[keyof typeof GarmentTaggingUnauthorizedErrorMessageEnum]

/**
 * @export
 */
export const GarmentTaggingUnauthorizedErrorErrorEnum = {
  Unauthorized: 'Unauthorized',
} as const
export type GarmentTaggingUnauthorizedErrorErrorEnum =
  (typeof GarmentTaggingUnauthorizedErrorErrorEnum)[keyof typeof GarmentTaggingUnauthorizedErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentTaggingUnavailableError
 */
export interface GarmentTaggingUnavailableError {
  /**
   *
   * @type {GarmentTaggingUnavailableErrorStatusCodeEnum}
   * @memberof GarmentTaggingUnavailableError
   */
  statusCode: GarmentTaggingUnavailableErrorStatusCodeEnum
  /**
   *
   * @type {GarmentTaggingUnavailableErrorMessageEnum}
   * @memberof GarmentTaggingUnavailableError
   */
  message: GarmentTaggingUnavailableErrorMessageEnum
  /**
   *
   * @type {GarmentTaggingUnavailableErrorErrorEnum}
   * @memberof GarmentTaggingUnavailableError
   */
  error: GarmentTaggingUnavailableErrorErrorEnum
}

/**
 * @export
 */
export const GarmentTaggingUnavailableErrorStatusCodeEnum = {
  NUMBER_503: 503,
} as const
export type GarmentTaggingUnavailableErrorStatusCodeEnum =
  (typeof GarmentTaggingUnavailableErrorStatusCodeEnum)[keyof typeof GarmentTaggingUnavailableErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentTaggingUnavailableErrorMessageEnum = {
  TAGGING_INFERENCE_UNAVAILABLE: 'TAGGING_INFERENCE_UNAVAILABLE',
} as const
export type GarmentTaggingUnavailableErrorMessageEnum =
  (typeof GarmentTaggingUnavailableErrorMessageEnum)[keyof typeof GarmentTaggingUnavailableErrorMessageEnum]

/**
 * @export
 */
export const GarmentTaggingUnavailableErrorErrorEnum = {
  Service_Unavailable: 'Service Unavailable',
} as const
export type GarmentTaggingUnavailableErrorErrorEnum =
  (typeof GarmentTaggingUnavailableErrorErrorEnum)[keyof typeof GarmentTaggingUnavailableErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentTagsBadRequestError
 */
export interface GarmentTagsBadRequestError {
  /**
   *
   * @type {GarmentTagsBadRequestErrorStatusCodeEnum}
   * @memberof GarmentTagsBadRequestError
   */
  statusCode: GarmentTagsBadRequestErrorStatusCodeEnum
  /**
   *
   * @type {GarmentTagsBadRequestErrorMessage}
   * @memberof GarmentTagsBadRequestError
   */
  message: GarmentTagsBadRequestErrorMessage
  /**
   *
   * @type {GarmentTagsBadRequestErrorErrorEnum}
   * @memberof GarmentTagsBadRequestError
   */
  error: GarmentTagsBadRequestErrorErrorEnum
}

/**
 * @export
 */
export const GarmentTagsBadRequestErrorStatusCodeEnum = {
  NUMBER_400: 400,
} as const
export type GarmentTagsBadRequestErrorStatusCodeEnum =
  (typeof GarmentTagsBadRequestErrorStatusCodeEnum)[keyof typeof GarmentTagsBadRequestErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentTagsBadRequestErrorErrorEnum = {
  Bad_Request: 'Bad Request',
} as const
export type GarmentTagsBadRequestErrorErrorEnum =
  (typeof GarmentTagsBadRequestErrorErrorEnum)[keyof typeof GarmentTagsBadRequestErrorErrorEnum]

/**
 *
 * @export
 * @interface GarmentTagsBadRequestErrorMessage
 */
export interface GarmentTagsBadRequestErrorMessage {}
/**
 *
 * @export
 * @interface GarmentUpdateConflictError
 */
export interface GarmentUpdateConflictError {
  /**
   *
   * @type {GarmentUpdateConflictErrorStatusCodeEnum}
   * @memberof GarmentUpdateConflictError
   */
  statusCode: GarmentUpdateConflictErrorStatusCodeEnum
  /**
   *
   * @type {GarmentUpdateConflictErrorMessageEnum}
   * @memberof GarmentUpdateConflictError
   */
  message: GarmentUpdateConflictErrorMessageEnum
  /**
   *
   * @type {GarmentUpdateConflictErrorErrorEnum}
   * @memberof GarmentUpdateConflictError
   */
  error: GarmentUpdateConflictErrorErrorEnum
}

/**
 * @export
 */
export const GarmentUpdateConflictErrorStatusCodeEnum = {
  NUMBER_409: 409,
} as const
export type GarmentUpdateConflictErrorStatusCodeEnum =
  (typeof GarmentUpdateConflictErrorStatusCodeEnum)[keyof typeof GarmentUpdateConflictErrorStatusCodeEnum]

/**
 * @export
 */
export const GarmentUpdateConflictErrorMessageEnum = {
  GARMENT_ANALYSIS_PENDING: 'GARMENT_ANALYSIS_PENDING',
  GARMENT_NOT_TAGGABLE: 'GARMENT_NOT_TAGGABLE',
  CONCURRENT_TAG_UPDATE: 'CONCURRENT_TAG_UPDATE',
} as const
export type GarmentUpdateConflictErrorMessageEnum =
  (typeof GarmentUpdateConflictErrorMessageEnum)[keyof typeof GarmentUpdateConflictErrorMessageEnum]

/**
 * @export
 */
export const GarmentUpdateConflictErrorErrorEnum = {
  Conflict: 'Conflict',
} as const
export type GarmentUpdateConflictErrorErrorEnum =
  (typeof GarmentUpdateConflictErrorErrorEnum)[keyof typeof GarmentUpdateConflictErrorErrorEnum]

/**
 *
 * @export
 * @interface GetAlertPreferencesResponse
 */
export interface GetAlertPreferencesResponse {
  /**
   *
   * @type {GetAlertPreferencesResponseData}
   * @memberof GetAlertPreferencesResponse
   */
  data: GetAlertPreferencesResponseData
}
/**
 *
 * @export
 * @interface GetAlertPreferencesResponseData
 */
export interface GetAlertPreferencesResponseData {
  /**
   *
   * @type {GetAlertPreferencesResponseDataPreferences}
   * @memberof GetAlertPreferencesResponseData
   */
  preferences: GetAlertPreferencesResponseDataPreferences
  /**
   *
   * @type {Array<UpdateAlertRulesInputRulesInner>}
   * @memberof GetAlertPreferencesResponseData
   */
  rules: Array<UpdateAlertRulesInputRulesInner>
}
/**
 * Cross-field invariant enforced at runtime and NOT expressible in this schema: when quietHoursEnabled is true, quietHoursStart and quietHoursEnd must differ. JSON Schema has no operator comparing two sibling properties, so this rule is only visible here and in the 400 returned when it is violated.
 * @export
 * @interface GetAlertPreferencesResponseDataPreferences
 */
export interface GetAlertPreferencesResponseDataPreferences {
  /**
   *
   * @type {boolean}
   * @memberof GetAlertPreferencesResponseDataPreferences
   */
  quietHoursEnabled: boolean
  /**
   *
   * @type {boolean}
   * @memberof GetAlertPreferencesResponseDataPreferences
   */
  pushEnabled: boolean
  /**
   *
   * @type {string}
   * @memberof GetAlertPreferencesResponseDataPreferences
   */
  quietHoursStart: string
  /**
   *
   * @type {string}
   * @memberof GetAlertPreferencesResponseDataPreferences
   */
  quietHoursEnd: string
  /**
   * Invariant enforced at runtime and NOT expressible in this schema: the value must be a valid IANA timezone name as resolved by the host Intl database (for example America/New_York). Any other bounded string is rejected.
   * @type {string}
   * @memberof GetAlertPreferencesResponseDataPreferences
   */
  timezone: string
}
/**
 *
 * @export
 * @interface GuardianConsentInput
 */
export interface GuardianConsentInput {
  /**
   *
   * @type {string}
   * @memberof GuardianConsentInput
   */
  guardianId: string
  /**
   *
   * @type {string}
   * @memberof GuardianConsentInput
   */
  teenId: string
  /**
   *
   * @type {string}
   * @memberof GuardianConsentInput
   */
  consentLevel: string
  /**
   *
   * @type {string}
   * @memberof GuardianConsentInput
   */
  timestamp?: string
}
/**
 *
 * @export
 * @interface GuardianConsentRevokeInput
 */
export interface GuardianConsentRevokeInput {
  /**
   *
   * @type {string}
   * @memberof GuardianConsentRevokeInput
   */
  guardianId: string
  /**
   *
   * @type {string}
   * @memberof GuardianConsentRevokeInput
   */
  teenId: string
}
/**
 *
 * @export
 * @interface GuardianConsentRevokeResponse
 */
export interface GuardianConsentRevokeResponse {
  /**
   *
   * @type {string}
   * @memberof GuardianConsentRevokeResponse
   */
  guardianId: string
  /**
   *
   * @type {string}
   * @memberof GuardianConsentRevokeResponse
   */
  teenId: string
  /**
   *
   * @type {string}
   * @memberof GuardianConsentRevokeResponse
   */
  revokedAt: string
  /**
   *
   * @type {number}
   * @memberof GuardianConsentRevokeResponse
   */
  remainingActiveGuardians: number
  /**
   *
   * @type {boolean}
   * @memberof GuardianConsentRevokeResponse
   */
  sessionInvalidated: boolean
  /**
   *
   * @type {boolean}
   * @memberof GuardianConsentRevokeResponse
   */
  notificationQueued: boolean
}
/**
 *
 * @export
 * @interface GuardianInvitationAcceptInput
 */
export interface GuardianInvitationAcceptInput {
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationAcceptInput
   */
  token: string
}
/**
 *
 * @export
 * @interface GuardianInvitationAcceptResponse
 */
export interface GuardianInvitationAcceptResponse {
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationAcceptResponse
   */
  teenId: string
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationAcceptResponse
   */
  teenEmail: string
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationAcceptResponse
   */
  guardianId: string
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationAcceptResponse
   */
  guardianEmail: string
  /**
   *
   * @type {GuardianInvitationAcceptResponseConsentLevelEnum}
   * @memberof GuardianInvitationAcceptResponse
   */
  consentLevel: GuardianInvitationAcceptResponseConsentLevelEnum
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationAcceptResponse
   */
  grantedAt: string
}

/**
 * @export
 */
export const GuardianInvitationAcceptResponseConsentLevelEnum = {
  read_only: 'read_only',
  full_access: 'full_access',
} as const
export type GuardianInvitationAcceptResponseConsentLevelEnum =
  (typeof GuardianInvitationAcceptResponseConsentLevelEnum)[keyof typeof GuardianInvitationAcceptResponseConsentLevelEnum]

/**
 *
 * @export
 * @interface GuardianInvitationInput
 */
export interface GuardianInvitationInput {
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationInput
   */
  teenId: string
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationInput
   */
  guardianEmail: string
  /**
   *
   * @type {GuardianInvitationInputConsentLevelEnum}
   * @memberof GuardianInvitationInput
   */
  consentLevel?: GuardianInvitationInputConsentLevelEnum
}

/**
 * @export
 */
export const GuardianInvitationInputConsentLevelEnum = {
  read_only: 'read_only',
  full_access: 'full_access',
} as const
export type GuardianInvitationInputConsentLevelEnum =
  (typeof GuardianInvitationInputConsentLevelEnum)[keyof typeof GuardianInvitationInputConsentLevelEnum]

/**
 *
 * @export
 * @interface GuardianInvitationResponse
 */
export interface GuardianInvitationResponse {
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationResponse
   */
  invitationId: string
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationResponse
   */
  teenId: string
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationResponse
   */
  guardianEmail: string
  /**
   *
   * @type {GuardianInvitationResponseConsentLevelEnum}
   * @memberof GuardianInvitationResponse
   */
  consentLevel: GuardianInvitationResponseConsentLevelEnum
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationResponse
   */
  expiresAt: string
  /**
   *
   * @type {string}
   * @memberof GuardianInvitationResponse
   */
  invitationLink: string
  /**
   *
   * @type {boolean}
   * @memberof GuardianInvitationResponse
   */
  deliveryQueued: boolean
}

/**
 * @export
 */
export const GuardianInvitationResponseConsentLevelEnum = {
  read_only: 'read_only',
  full_access: 'full_access',
} as const
export type GuardianInvitationResponseConsentLevelEnum =
  (typeof GuardianInvitationResponseConsentLevelEnum)[keyof typeof GuardianInvitationResponseConsentLevelEnum]

/**
 *
 * @export
 * @interface InternalServerErrorHttpError
 */
export interface InternalServerErrorHttpError {
  /**
   *
   * @type {InternalServerErrorHttpErrorStatusCodeEnum}
   * @memberof InternalServerErrorHttpError
   */
  statusCode: InternalServerErrorHttpErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof InternalServerErrorHttpError
   */
  message: string
  /**
   *
   * @type {InternalServerErrorHttpErrorErrorEnum}
   * @memberof InternalServerErrorHttpError
   */
  error: InternalServerErrorHttpErrorErrorEnum
}

/**
 * @export
 */
export const InternalServerErrorHttpErrorStatusCodeEnum = {
  NUMBER_500: 500,
} as const
export type InternalServerErrorHttpErrorStatusCodeEnum =
  (typeof InternalServerErrorHttpErrorStatusCodeEnum)[keyof typeof InternalServerErrorHttpErrorStatusCodeEnum]

/**
 * @export
 */
export const InternalServerErrorHttpErrorErrorEnum = {
  Internal_Server_Error: 'Internal Server Error',
} as const
export type InternalServerErrorHttpErrorErrorEnum =
  (typeof InternalServerErrorHttpErrorErrorEnum)[keyof typeof InternalServerErrorHttpErrorErrorEnum]

/**
 *
 * @export
 * @interface LatestWeatherPathParams
 */
export interface LatestWeatherPathParams {
  /**
   * Canonical weather location key.
   * @type {string}
   * @memberof LatestWeatherPathParams
   */
  locationKey: string
}
/**
 *
 * @export
 * @interface LatestWeatherResponse
 */
export interface LatestWeatherResponse {
  /**
   *
   * @type {LatestWeatherResponseData}
   * @memberof LatestWeatherResponse
   */
  data: LatestWeatherResponseData
}
/**
 * @type LatestWeatherResponseData
 *
 * @export
 */
export type LatestWeatherResponseData =
  | LatestWeatherResponseDataOneOf
  | LatestWeatherResponseDataOneOf1
  | LatestWeatherResponseDataOneOf2
  | LatestWeatherResponseDataOneOf3
/**
 *
 * @export
 * @interface LatestWeatherResponseDataOneOf
 */
export interface LatestWeatherResponseDataOneOf {
  /**
   *
   * @type {LatestWeatherResponseDataOneOfStatusEnum}
   * @memberof LatestWeatherResponseDataOneOf
   */
  status: LatestWeatherResponseDataOneOfStatusEnum
  /**
   *
   * @type {LatestWeatherResponseDataOneOfWeather}
   * @memberof LatestWeatherResponseDataOneOf
   */
  weather: LatestWeatherResponseDataOneOfWeather
}

/**
 * @export
 */
export const LatestWeatherResponseDataOneOfStatusEnum = {
  fresh: 'fresh',
} as const
export type LatestWeatherResponseDataOneOfStatusEnum =
  (typeof LatestWeatherResponseDataOneOfStatusEnum)[keyof typeof LatestWeatherResponseDataOneOfStatusEnum]

/**
 *
 * @export
 * @interface LatestWeatherResponseDataOneOf1
 */
export interface LatestWeatherResponseDataOneOf1 {
  /**
   *
   * @type {LatestWeatherResponseDataOneOf1StatusEnum}
   * @memberof LatestWeatherResponseDataOneOf1
   */
  status: LatestWeatherResponseDataOneOf1StatusEnum
  /**
   *
   * @type {LatestWeatherResponseDataOneOfWeather}
   * @memberof LatestWeatherResponseDataOneOf1
   */
  weather: LatestWeatherResponseDataOneOfWeather
  /**
   *
   * @type {LatestWeatherResponseDataOneOf1MessageEnum}
   * @memberof LatestWeatherResponseDataOneOf1
   */
  message: LatestWeatherResponseDataOneOf1MessageEnum
}

/**
 * @export
 */
export const LatestWeatherResponseDataOneOf1StatusEnum = {
  cached: 'cached',
} as const
export type LatestWeatherResponseDataOneOf1StatusEnum =
  (typeof LatestWeatherResponseDataOneOf1StatusEnum)[keyof typeof LatestWeatherResponseDataOneOf1StatusEnum]

/**
 * @export
 */
export const LatestWeatherResponseDataOneOf1MessageEnum = {
  Using_recently_cached_weather_data: 'Using recently cached weather data.',
} as const
export type LatestWeatherResponseDataOneOf1MessageEnum =
  (typeof LatestWeatherResponseDataOneOf1MessageEnum)[keyof typeof LatestWeatherResponseDataOneOf1MessageEnum]

/**
 *
 * @export
 * @interface LatestWeatherResponseDataOneOf2
 */
export interface LatestWeatherResponseDataOneOf2 {
  /**
   *
   * @type {LatestWeatherResponseDataOneOf2StatusEnum}
   * @memberof LatestWeatherResponseDataOneOf2
   */
  status: LatestWeatherResponseDataOneOf2StatusEnum
  /**
   *
   * @type {LatestWeatherResponseDataOneOfWeather}
   * @memberof LatestWeatherResponseDataOneOf2
   */
  weather: LatestWeatherResponseDataOneOfWeather
  /**
   *
   * @type {LatestWeatherResponseDataOneOf2MessageEnum}
   * @memberof LatestWeatherResponseDataOneOf2
   */
  message: LatestWeatherResponseDataOneOf2MessageEnum
}

/**
 * @export
 */
export const LatestWeatherResponseDataOneOf2StatusEnum = {
  stale: 'stale',
} as const
export type LatestWeatherResponseDataOneOf2StatusEnum =
  (typeof LatestWeatherResponseDataOneOf2StatusEnum)[keyof typeof LatestWeatherResponseDataOneOf2StatusEnum]

/**
 * @export
 */
export const LatestWeatherResponseDataOneOf2MessageEnum = {
  Weather_data_is_delayed__Check_again_shortly:
    'Weather data is delayed. Check again shortly.',
} as const
export type LatestWeatherResponseDataOneOf2MessageEnum =
  (typeof LatestWeatherResponseDataOneOf2MessageEnum)[keyof typeof LatestWeatherResponseDataOneOf2MessageEnum]

/**
 *
 * @export
 * @interface LatestWeatherResponseDataOneOf3
 */
export interface LatestWeatherResponseDataOneOf3 {
  /**
   *
   * @type {LatestWeatherResponseDataOneOf3StatusEnum}
   * @memberof LatestWeatherResponseDataOneOf3
   */
  status: LatestWeatherResponseDataOneOf3StatusEnum
  /**
   *
   * @type {null}
   * @memberof LatestWeatherResponseDataOneOf3
   */
  weather: null
  /**
   *
   * @type {LatestWeatherResponseDataOneOf3MessageEnum}
   * @memberof LatestWeatherResponseDataOneOf3
   */
  message: LatestWeatherResponseDataOneOf3MessageEnum
}

/**
 * @export
 */
export const LatestWeatherResponseDataOneOf3StatusEnum = {
  unavailable: 'unavailable',
} as const
export type LatestWeatherResponseDataOneOf3StatusEnum =
  (typeof LatestWeatherResponseDataOneOf3StatusEnum)[keyof typeof LatestWeatherResponseDataOneOf3StatusEnum]

/**
 * @export
 */
export const LatestWeatherResponseDataOneOf3MessageEnum = {
  Weather_data_is_temporarily_unavailable: 'Weather data is temporarily unavailable.',
} as const
export type LatestWeatherResponseDataOneOf3MessageEnum =
  (typeof LatestWeatherResponseDataOneOf3MessageEnum)[keyof typeof LatestWeatherResponseDataOneOf3MessageEnum]

/**
 *
 * @export
 * @interface LatestWeatherResponseDataOneOfWeather
 */
export interface LatestWeatherResponseDataOneOfWeather {
  /**
   *
   * @type {string}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  locationKey: string
  /**
   *
   * @type {number}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  latitude: number
  /**
   *
   * @type {number}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  longitude: number
  /**
   *
   * @type {string}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  timezone: string
  /**
   *
   * @type {LatestWeatherResponseDataOneOfWeatherProviderEnum}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  provider: LatestWeatherResponseDataOneOfWeatherProviderEnum
  /**
   *
   * @type {string}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  providerUpdatedAt: string
  /**
   *
   * @type {string}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  fetchedAt: string
  /**
   *
   * @type {WeatherSnapshotCurrent}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  current: WeatherSnapshotCurrent
  /**
   *
   * @type {Array<WeatherSnapshotHourlyInner>}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  hourly: FixedLengthArray<WeatherSnapshotHourlyInner, 48>
  /**
   *
   * @type {Array<WeatherSnapshotAlertsInner>}
   * @memberof LatestWeatherResponseDataOneOfWeather
   */
  alerts: Array<WeatherSnapshotAlertsInner>
}

/**
 * @export
 */
export const LatestWeatherResponseDataOneOfWeatherProviderEnum = {
  openweather: 'openweather',
  weatherapi: 'weatherapi',
} as const
export type LatestWeatherResponseDataOneOfWeatherProviderEnum =
  (typeof LatestWeatherResponseDataOneOfWeatherProviderEnum)[keyof typeof LatestWeatherResponseDataOneOfWeatherProviderEnum]

/**
 *
 * @export
 * @interface LinkedGuardian
 */
export interface LinkedGuardian {
  /**
   *
   * @type {string}
   * @memberof LinkedGuardian
   */
  guardianId: string
  /**
   *
   * @type {LinkedGuardianStatusEnum}
   * @memberof LinkedGuardian
   */
  status: LinkedGuardianStatusEnum
  /**
   *
   * @type {string}
   * @memberof LinkedGuardian
   */
  consentGrantedAt: string | null
}

/**
 * @export
 */
export const LinkedGuardianStatusEnum = {
  pending: 'pending',
  granted: 'granted',
  revoked: 'revoked',
} as const
export type LinkedGuardianStatusEnum =
  (typeof LinkedGuardianStatusEnum)[keyof typeof LinkedGuardianStatusEnum]

/**
 *
 * @export
 * @interface LinkedTeen
 */
export interface LinkedTeen {
  /**
   *
   * @type {string}
   * @memberof LinkedTeen
   */
  teenId: string
  /**
   *
   * @type {LinkedTeenStatusEnum}
   * @memberof LinkedTeen
   */
  status: LinkedTeenStatusEnum
  /**
   *
   * @type {string}
   * @memberof LinkedTeen
   */
  consentGrantedAt: string | null
}

/**
 * @export
 */
export const LinkedTeenStatusEnum = {
  pending: 'pending',
  granted: 'granted',
  revoked: 'revoked',
} as const
export type LinkedTeenStatusEnum =
  (typeof LinkedTeenStatusEnum)[keyof typeof LinkedTeenStatusEnum]

/**
 *
 * @export
 * @interface ListSavedLocationsResponse
 */
export interface ListSavedLocationsResponse {
  /**
   *
   * @type {Array<ListSavedLocationsResponseDataInner>}
   * @memberof ListSavedLocationsResponse
   */
  data: Array<ListSavedLocationsResponseDataInner>
}
/**
 *
 * @export
 * @interface ListSavedLocationsResponseDataInner
 */
export interface ListSavedLocationsResponseDataInner {
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  id: string
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  label: string
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  locationKey: string
  /**
   *
   * @type {number}
   * @memberof ListSavedLocationsResponseDataInner
   */
  latitude: number
  /**
   *
   * @type {number}
   * @memberof ListSavedLocationsResponseDataInner
   */
  longitude: number
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  timezone: string
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  city: string | null
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  region: string | null
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  country: string | null
  /**
   *
   * @type {boolean}
   * @memberof ListSavedLocationsResponseDataInner
   */
  isPrimary: boolean
  /**
   *
   * @type {number}
   * @memberof ListSavedLocationsResponseDataInner
   */
  sortOrder: number
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  createdAt: string
  /**
   *
   * @type {string}
   * @memberof ListSavedLocationsResponseDataInner
   */
  updatedAt: string
}
/**
 *
 * @export
 * @interface ModerationActionInput
 */
export interface ModerationActionInput {
  /**
   *
   * @type {string}
   * @memberof ModerationActionInput
   */
  moderatorId: string
  /**
   *
   * @type {string}
   * @memberof ModerationActionInput
   */
  targetId: string
  /**
   *
   * @type {string}
   * @memberof ModerationActionInput
   */
  action: string
  /**
   *
   * @type {string}
   * @memberof ModerationActionInput
   */
  reason: string
  /**
   *
   * @type {string}
   * @memberof ModerationActionInput
   */
  contentType?: string
  /**
   *
   * @type {string}
   * @memberof ModerationActionInput
   */
  timestamp?: string
}
/**
 *
 * @export
 * @interface NotFoundHttpError
 */
export interface NotFoundHttpError {
  /**
   *
   * @type {NotFoundHttpErrorStatusCodeEnum}
   * @memberof NotFoundHttpError
   */
  statusCode: NotFoundHttpErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof NotFoundHttpError
   */
  message: string
  /**
   *
   * @type {NotFoundHttpErrorErrorEnum}
   * @memberof NotFoundHttpError
   */
  error: NotFoundHttpErrorErrorEnum
}

/**
 * @export
 */
export const NotFoundHttpErrorStatusCodeEnum = {
  NUMBER_404: 404,
} as const
export type NotFoundHttpErrorStatusCodeEnum =
  (typeof NotFoundHttpErrorStatusCodeEnum)[keyof typeof NotFoundHttpErrorStatusCodeEnum]

/**
 * @export
 */
export const NotFoundHttpErrorErrorEnum = {
  Not_Found: 'Not Found',
} as const
export type NotFoundHttpErrorErrorEnum =
  (typeof NotFoundHttpErrorErrorEnum)[keyof typeof NotFoundHttpErrorErrorEnum]

/**
 *
 * @export
 * @interface OnboardingBadRequestError
 */
export interface OnboardingBadRequestError {
  /**
   *
   * @type {OnboardingBadRequestErrorStatusCodeEnum}
   * @memberof OnboardingBadRequestError
   */
  statusCode: OnboardingBadRequestErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof OnboardingBadRequestError
   */
  message: string
  /**
   *
   * @type {OnboardingBadRequestErrorErrorEnum}
   * @memberof OnboardingBadRequestError
   */
  error: OnboardingBadRequestErrorErrorEnum
}

/**
 * @export
 */
export const OnboardingBadRequestErrorStatusCodeEnum = {
  NUMBER_400: 400,
} as const
export type OnboardingBadRequestErrorStatusCodeEnum =
  (typeof OnboardingBadRequestErrorStatusCodeEnum)[keyof typeof OnboardingBadRequestErrorStatusCodeEnum]

/**
 * @export
 */
export const OnboardingBadRequestErrorErrorEnum = {
  Bad_Request: 'Bad Request',
} as const
export type OnboardingBadRequestErrorErrorEnum =
  (typeof OnboardingBadRequestErrorErrorEnum)[keyof typeof OnboardingBadRequestErrorErrorEnum]

/**
 *
 * @export
 * @interface OnboardingConflictError
 */
export interface OnboardingConflictError {
  /**
   *
   * @type {OnboardingConflictErrorStatusCodeEnum}
   * @memberof OnboardingConflictError
   */
  statusCode: OnboardingConflictErrorStatusCodeEnum
  /**
   *
   * @type {OnboardingConflictErrorMessageEnum}
   * @memberof OnboardingConflictError
   */
  message: OnboardingConflictErrorMessageEnum
  /**
   *
   * @type {OnboardingConflictErrorErrorEnum}
   * @memberof OnboardingConflictError
   */
  error: OnboardingConflictErrorErrorEnum
}

/**
 * @export
 */
export const OnboardingConflictErrorStatusCodeEnum = {
  NUMBER_409: 409,
} as const
export type OnboardingConflictErrorStatusCodeEnum =
  (typeof OnboardingConflictErrorStatusCodeEnum)[keyof typeof OnboardingConflictErrorStatusCodeEnum]

/**
 * @export
 */
export const OnboardingConflictErrorMessageEnum = {
  INVALID_STEP_TRANSITION: 'INVALID_STEP_TRANSITION',
} as const
export type OnboardingConflictErrorMessageEnum =
  (typeof OnboardingConflictErrorMessageEnum)[keyof typeof OnboardingConflictErrorMessageEnum]

/**
 * @export
 */
export const OnboardingConflictErrorErrorEnum = {
  Conflict: 'Conflict',
} as const
export type OnboardingConflictErrorErrorEnum =
  (typeof OnboardingConflictErrorErrorEnum)[keyof typeof OnboardingConflictErrorErrorEnum]

/**
 *
 * @export
 * @interface OnboardingForbiddenError
 */
export interface OnboardingForbiddenError {
  /**
   *
   * @type {OnboardingForbiddenErrorStatusCodeEnum}
   * @memberof OnboardingForbiddenError
   */
  statusCode: OnboardingForbiddenErrorStatusCodeEnum
  /**
   *
   * @type {OnboardingForbiddenErrorMessageEnum}
   * @memberof OnboardingForbiddenError
   */
  message: OnboardingForbiddenErrorMessageEnum
  /**
   *
   * @type {OnboardingForbiddenErrorErrorEnum}
   * @memberof OnboardingForbiddenError
   */
  error: OnboardingForbiddenErrorErrorEnum
}

/**
 * @export
 */
export const OnboardingForbiddenErrorStatusCodeEnum = {
  NUMBER_403: 403,
} as const
export type OnboardingForbiddenErrorStatusCodeEnum =
  (typeof OnboardingForbiddenErrorStatusCodeEnum)[keyof typeof OnboardingForbiddenErrorStatusCodeEnum]

/**
 * @export
 */
export const OnboardingForbiddenErrorMessageEnum = {
  GUARDIAN_READ_ONLY: 'GUARDIAN_READ_ONLY',
  GUARDIAN_CONSENT_REQUIRED: 'GUARDIAN_CONSENT_REQUIRED',
} as const
export type OnboardingForbiddenErrorMessageEnum =
  (typeof OnboardingForbiddenErrorMessageEnum)[keyof typeof OnboardingForbiddenErrorMessageEnum]

/**
 * @export
 */
export const OnboardingForbiddenErrorErrorEnum = {
  Forbidden: 'Forbidden',
} as const
export type OnboardingForbiddenErrorErrorEnum =
  (typeof OnboardingForbiddenErrorErrorEnum)[keyof typeof OnboardingForbiddenErrorErrorEnum]

/**
 *
 * @export
 * @interface OnboardingPreconditionFailedError
 */
export interface OnboardingPreconditionFailedError {
  /**
   *
   * @type {OnboardingPreconditionFailedErrorStatusCodeEnum}
   * @memberof OnboardingPreconditionFailedError
   */
  statusCode: OnboardingPreconditionFailedErrorStatusCodeEnum
  /**
   *
   * @type {OnboardingPreconditionFailedErrorMessageEnum}
   * @memberof OnboardingPreconditionFailedError
   */
  message: OnboardingPreconditionFailedErrorMessageEnum
  /**
   *
   * @type {OnboardingPreconditionFailedErrorErrorEnum}
   * @memberof OnboardingPreconditionFailedError
   */
  error: OnboardingPreconditionFailedErrorErrorEnum
}

/**
 * @export
 */
export const OnboardingPreconditionFailedErrorStatusCodeEnum = {
  NUMBER_412: 412,
} as const
export type OnboardingPreconditionFailedErrorStatusCodeEnum =
  (typeof OnboardingPreconditionFailedErrorStatusCodeEnum)[keyof typeof OnboardingPreconditionFailedErrorStatusCodeEnum]

/**
 * @export
 */
export const OnboardingPreconditionFailedErrorMessageEnum = {
  ONBOARDING_REVISION_MISMATCH: 'ONBOARDING_REVISION_MISMATCH',
} as const
export type OnboardingPreconditionFailedErrorMessageEnum =
  (typeof OnboardingPreconditionFailedErrorMessageEnum)[keyof typeof OnboardingPreconditionFailedErrorMessageEnum]

/**
 * @export
 */
export const OnboardingPreconditionFailedErrorErrorEnum = {
  Precondition_Failed: 'Precondition Failed',
} as const
export type OnboardingPreconditionFailedErrorErrorEnum =
  (typeof OnboardingPreconditionFailedErrorErrorEnum)[keyof typeof OnboardingPreconditionFailedErrorErrorEnum]

/**
 *
 * @export
 * @interface OnboardingPreconditionRequiredError
 */
export interface OnboardingPreconditionRequiredError {
  /**
   *
   * @type {OnboardingPreconditionRequiredErrorStatusCodeEnum}
   * @memberof OnboardingPreconditionRequiredError
   */
  statusCode: OnboardingPreconditionRequiredErrorStatusCodeEnum
  /**
   *
   * @type {OnboardingPreconditionRequiredErrorMessageEnum}
   * @memberof OnboardingPreconditionRequiredError
   */
  message: OnboardingPreconditionRequiredErrorMessageEnum
  /**
   *
   * @type {OnboardingPreconditionRequiredErrorErrorEnum}
   * @memberof OnboardingPreconditionRequiredError
   */
  error?: OnboardingPreconditionRequiredErrorErrorEnum
}

/**
 * @export
 */
export const OnboardingPreconditionRequiredErrorStatusCodeEnum = {
  NUMBER_428: 428,
} as const
export type OnboardingPreconditionRequiredErrorStatusCodeEnum =
  (typeof OnboardingPreconditionRequiredErrorStatusCodeEnum)[keyof typeof OnboardingPreconditionRequiredErrorStatusCodeEnum]

/**
 * @export
 */
export const OnboardingPreconditionRequiredErrorMessageEnum = {
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
} as const
export type OnboardingPreconditionRequiredErrorMessageEnum =
  (typeof OnboardingPreconditionRequiredErrorMessageEnum)[keyof typeof OnboardingPreconditionRequiredErrorMessageEnum]

/**
 * @export
 */
export const OnboardingPreconditionRequiredErrorErrorEnum = {
  Precondition_Required: 'Precondition Required',
} as const
export type OnboardingPreconditionRequiredErrorErrorEnum =
  (typeof OnboardingPreconditionRequiredErrorErrorEnum)[keyof typeof OnboardingPreconditionRequiredErrorErrorEnum]

/**
 *
 * @export
 * @interface OutfitCapsuleListResponse
 */
export interface OutfitCapsuleListResponse {
  /**
   *
   * @type {Array<OutfitCapsuleResponseData>}
   * @memberof OutfitCapsuleListResponse
   */
  data: Array<OutfitCapsuleResponseData>
  /**
   *
   * @type {number}
   * @memberof OutfitCapsuleListResponse
   */
  total: number
  /**
   *
   * @type {number}
   * @memberof OutfitCapsuleListResponse
   */
  limit: number
  /**
   *
   * @type {number}
   * @memberof OutfitCapsuleListResponse
   */
  offset: number
}
/**
 *
 * @export
 * @interface OutfitCapsuleResponse
 */
export interface OutfitCapsuleResponse {
  /**
   *
   * @type {OutfitCapsuleResponseData}
   * @memberof OutfitCapsuleResponse
   */
  data: OutfitCapsuleResponseData
}
/**
 *
 * @export
 * @interface OutfitCapsuleResponseData
 */
export interface OutfitCapsuleResponseData {
  /**
   *
   * @type {string}
   * @memberof OutfitCapsuleResponseData
   */
  id: string
  /**
   *
   * @type {string}
   * @memberof OutfitCapsuleResponseData
   */
  ownerUserId: string
  /**
   *
   * @type {string}
   * @memberof OutfitCapsuleResponseData
   */
  name: string
  /**
   *
   * @type {string}
   * @memberof OutfitCapsuleResponseData
   */
  description: string | null
  /**
   *
   * @type {Array<OutfitCapsuleResponseDataOccasionsEnum>}
   * @memberof OutfitCapsuleResponseData
   */
  occasions: Array<OutfitCapsuleResponseDataOccasionsEnum>
  /**
   *
   * @type {boolean}
   * @memberof OutfitCapsuleResponseData
   */
  isFavorite: boolean
  /**
   *
   * @type {number}
   * @memberof OutfitCapsuleResponseData
   */
  revision: number
  /**
   *
   * @type {OutfitCapsuleResponseDataAvailabilityStatusEnum}
   * @memberof OutfitCapsuleResponseData
   */
  availabilityStatus: OutfitCapsuleResponseDataAvailabilityStatusEnum
  /**
   *
   * @type {number}
   * @memberof OutfitCapsuleResponseData
   */
  unavailableGarmentCount: number
  /**
   *
   * @type {Array<OutfitCapsuleResponseDataGarmentsInner>}
   * @memberof OutfitCapsuleResponseData
   */
  garments: Array<OutfitCapsuleResponseDataGarmentsInner>
  /**
   *
   * @type {string}
   * @memberof OutfitCapsuleResponseData
   */
  createdAt: string
  /**
   *
   * @type {string}
   * @memberof OutfitCapsuleResponseData
   */
  updatedAt: string
}

/**
 * @export
 */
export const OutfitCapsuleResponseDataOccasionsEnum = {
  work: 'work',
  casual: 'casual',
  formal: 'formal',
  sport: 'sport',
  travel: 'travel',
  evening: 'evening',
  outdoor: 'outdoor',
  home: 'home',
} as const
export type OutfitCapsuleResponseDataOccasionsEnum =
  (typeof OutfitCapsuleResponseDataOccasionsEnum)[keyof typeof OutfitCapsuleResponseDataOccasionsEnum]

/**
 * @export
 */
export const OutfitCapsuleResponseDataAvailabilityStatusEnum = {
  ready: 'ready',
  needs_repair: 'needs_repair',
} as const
export type OutfitCapsuleResponseDataAvailabilityStatusEnum =
  (typeof OutfitCapsuleResponseDataAvailabilityStatusEnum)[keyof typeof OutfitCapsuleResponseDataAvailabilityStatusEnum]

/**
 *
 * @export
 * @interface OutfitCapsuleResponseDataGarmentsInner
 */
export interface OutfitCapsuleResponseDataGarmentsInner {
  /**
   *
   * @type {string}
   * @memberof OutfitCapsuleResponseDataGarmentsInner
   */
  id: string
  /**
   *
   * @type {OutfitCapsuleResponseDataGarmentsInnerCategoryEnum}
   * @memberof OutfitCapsuleResponseDataGarmentsInner
   */
  category: OutfitCapsuleResponseDataGarmentsInnerCategoryEnum | null
  /**
   *
   * @type {OutfitCapsuleResponseDataGarmentsInnerMaterialEnum}
   * @memberof OutfitCapsuleResponseDataGarmentsInner
   */
  material: OutfitCapsuleResponseDataGarmentsInnerMaterialEnum | null
  /**
   *
   * @type {OutfitCapsuleResponseDataGarmentsInnerComfortRangeEnum}
   * @memberof OutfitCapsuleResponseDataGarmentsInner
   */
  comfortRange: OutfitCapsuleResponseDataGarmentsInnerComfortRangeEnum | null
  /**
   *
   * @type {CreateGarmentItemResponseDataImageAccess}
   * @memberof OutfitCapsuleResponseDataGarmentsInner
   */
  imageAccess: CreateGarmentItemResponseDataImageAccess
  /**
   *
   * @type {OutfitCapsuleResponseDataGarmentsInnerAvailabilityStatusEnum}
   * @memberof OutfitCapsuleResponseDataGarmentsInner
   */
  availabilityStatus: OutfitCapsuleResponseDataGarmentsInnerAvailabilityStatusEnum
  /**
   *
   * @type {number}
   * @memberof OutfitCapsuleResponseDataGarmentsInner
   */
  garmentOrder: number
}

/**
 * @export
 */
export const OutfitCapsuleResponseDataGarmentsInnerCategoryEnum = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  dress: 'dress',
  shoes: 'shoes',
  accessory: 'accessory',
} as const
export type OutfitCapsuleResponseDataGarmentsInnerCategoryEnum =
  (typeof OutfitCapsuleResponseDataGarmentsInnerCategoryEnum)[keyof typeof OutfitCapsuleResponseDataGarmentsInnerCategoryEnum]

/**
 * @export
 */
export const OutfitCapsuleResponseDataGarmentsInnerMaterialEnum = {
  cotton: 'cotton',
  wool: 'wool',
  linen: 'linen',
  leather: 'leather',
  denim: 'denim',
  fleece: 'fleece',
  synthetic: 'synthetic',
  down: 'down',
  silk: 'silk',
} as const
export type OutfitCapsuleResponseDataGarmentsInnerMaterialEnum =
  (typeof OutfitCapsuleResponseDataGarmentsInnerMaterialEnum)[keyof typeof OutfitCapsuleResponseDataGarmentsInnerMaterialEnum]

/**
 * @export
 */
export const OutfitCapsuleResponseDataGarmentsInnerComfortRangeEnum = {
  cold: 'cold',
  cool: 'cool',
  mild: 'mild',
  warm: 'warm',
  hot: 'hot',
} as const
export type OutfitCapsuleResponseDataGarmentsInnerComfortRangeEnum =
  (typeof OutfitCapsuleResponseDataGarmentsInnerComfortRangeEnum)[keyof typeof OutfitCapsuleResponseDataGarmentsInnerComfortRangeEnum]

/**
 * @export
 */
export const OutfitCapsuleResponseDataGarmentsInnerAvailabilityStatusEnum = {
  ready: 'ready',
  needs_repair: 'needs_repair',
} as const
export type OutfitCapsuleResponseDataGarmentsInnerAvailabilityStatusEnum =
  (typeof OutfitCapsuleResponseDataGarmentsInnerAvailabilityStatusEnum)[keyof typeof OutfitCapsuleResponseDataGarmentsInnerAvailabilityStatusEnum]

/**
 *
 * @export
 * @interface PaletteAdvisorProfile
 */
export interface PaletteAdvisorProfile {
  /**
   *
   * @type {string}
   * @memberof PaletteAdvisorProfile
   */
  profileId: string | null
  /**
   *
   * @type {boolean}
   * @memberof PaletteAdvisorProfile
   */
  isEntitled: boolean
  /**
   *
   * @type {boolean}
   * @memberof PaletteAdvisorProfile
   */
  analysisEnabled: boolean
  /**
   *
   * @type {boolean}
   * @memberof PaletteAdvisorProfile
   */
  hasConsent: boolean
  /**
   *
   * @type {PaletteAdvisorProfileAnalysis}
   * @memberof PaletteAdvisorProfile
   */
  analysis: PaletteAdvisorProfileAnalysis | null
  /**
   *
   * @type {Array<PaletteAdvisorProfileRecommendationsInner>}
   * @memberof PaletteAdvisorProfile
   */
  recommendations: Array<PaletteAdvisorProfileRecommendationsInner>
}
/**
 * @type PaletteAdvisorProfileAnalysis
 * One variant per analysis status. failureReason is present exactly on failed, and the derived scalars are present exactly on ready, with depth nullable within ready for a wardrobe-sourced palette. A combination such as a ready palette with a failureReason is unrepresentable in the generated types.
 * @export
 */
export type PaletteAdvisorProfileAnalysis =
  | PaletteAnalysisOneOf
  | PaletteAnalysisOneOf1
  | PaletteAnalysisOneOf2
  | PaletteAnalysisOneOf3
  | PaletteAnalysisOneOf4
/**
 *
 * @export
 * @interface PaletteAdvisorProfileRecommendationsInner
 */
export interface PaletteAdvisorProfileRecommendationsInner {
  /**
   *
   * @type {PaletteAdvisorProfileRecommendationsInnerSlotEnum}
   * @memberof PaletteAdvisorProfileRecommendationsInner
   */
  slot: PaletteAdvisorProfileRecommendationsInnerSlotEnum
  /**
   *
   * @type {string}
   * @memberof PaletteAdvisorProfileRecommendationsInner
   */
  itemKey: string
  /**
   *
   * @type {string}
   * @memberof PaletteAdvisorProfileRecommendationsInner
   */
  labelKey: string
  /**
   *
   * @type {string}
   * @memberof PaletteAdvisorProfileRecommendationsInner
   */
  swatchHex: string
  /**
   *
   * @type {boolean}
   * @memberof PaletteAdvisorProfileRecommendationsInner
   */
  saved: boolean
  /**
   *
   * @type {AdvisorRecommendationCardSponsored}
   * @memberof PaletteAdvisorProfileRecommendationsInner
   */
  sponsored: AdvisorRecommendationCardSponsored
}

/**
 * @export
 */
export const PaletteAdvisorProfileRecommendationsInnerSlotEnum = {
  foundation: 'foundation',
  blush: 'blush',
  jewelry: 'jewelry',
  bag: 'bag',
  eyewear: 'eyewear',
} as const
export type PaletteAdvisorProfileRecommendationsInnerSlotEnum =
  (typeof PaletteAdvisorProfileRecommendationsInnerSlotEnum)[keyof typeof PaletteAdvisorProfileRecommendationsInnerSlotEnum]

/**
 *
 * @export
 * @interface PaletteAdvisorProfileResponse
 */
export interface PaletteAdvisorProfileResponse {
  /**
   *
   * @type {PaletteAdvisorProfileResponseData}
   * @memberof PaletteAdvisorProfileResponse
   */
  data: PaletteAdvisorProfileResponseData
}
/**
 *
 * @export
 * @interface PaletteAdvisorProfileResponseData
 */
export interface PaletteAdvisorProfileResponseData {
  /**
   *
   * @type {string}
   * @memberof PaletteAdvisorProfileResponseData
   */
  profileId: string | null
  /**
   *
   * @type {boolean}
   * @memberof PaletteAdvisorProfileResponseData
   */
  isEntitled: boolean
  /**
   *
   * @type {boolean}
   * @memberof PaletteAdvisorProfileResponseData
   */
  analysisEnabled: boolean
  /**
   *
   * @type {boolean}
   * @memberof PaletteAdvisorProfileResponseData
   */
  hasConsent: boolean
  /**
   *
   * @type {PaletteAdvisorProfileAnalysis}
   * @memberof PaletteAdvisorProfileResponseData
   */
  analysis: PaletteAdvisorProfileAnalysis | null
  /**
   *
   * @type {Array<PaletteAdvisorProfileRecommendationsInner>}
   * @memberof PaletteAdvisorProfileResponseData
   */
  recommendations: Array<PaletteAdvisorProfileRecommendationsInner>
}
/**
 * @type PaletteAnalysis
 * One variant per analysis status. failureReason is present exactly on failed, and the derived scalars are present exactly on ready, with depth nullable within ready for a wardrobe-sourced palette. A combination such as a ready palette with a failureReason is unrepresentable in the generated types.
 * @export
 */
export type PaletteAnalysis =
  | PaletteAnalysisOneOf
  | PaletteAnalysisOneOf1
  | PaletteAnalysisOneOf2
  | PaletteAnalysisOneOf3
  | PaletteAnalysisOneOf4

/**
 *
 * @export
 */
export const PaletteAnalysisFailureReason = {
  no_face: 'no_face',
  low_quality: 'low_quality',
  privacy_violation: 'privacy_violation',
  insufficient_wardrobe: 'insufficient_wardrobe',
  timeout: 'timeout',
  storage_error: 'storage_error',
} as const
export type PaletteAnalysisFailureReason =
  (typeof PaletteAnalysisFailureReason)[keyof typeof PaletteAnalysisFailureReason]

/**
 *
 * @export
 * @interface PaletteAnalysisOneOf
 */
export interface PaletteAnalysisOneOf {
  /**
   *
   * @type {PaletteAnalysisOneOfStatusEnum}
   * @memberof PaletteAnalysisOneOf
   */
  status: PaletteAnalysisOneOfStatusEnum
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf
   */
  failureReason: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf
   */
  source: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf
   */
  undertone: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf
   */
  depth: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf
   */
  confidence: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf
   */
  analysisVersion: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf
   */
  analyzedAt: null
}

/**
 * @export
 */
export const PaletteAnalysisOneOfStatusEnum = {
  pending_upload: 'pending_upload',
} as const
export type PaletteAnalysisOneOfStatusEnum =
  (typeof PaletteAnalysisOneOfStatusEnum)[keyof typeof PaletteAnalysisOneOfStatusEnum]

/**
 *
 * @export
 * @interface PaletteAnalysisOneOf1
 */
export interface PaletteAnalysisOneOf1 {
  /**
   *
   * @type {PaletteAnalysisOneOf1StatusEnum}
   * @memberof PaletteAnalysisOneOf1
   */
  status: PaletteAnalysisOneOf1StatusEnum
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf1
   */
  failureReason: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf1
   */
  source: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf1
   */
  undertone: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf1
   */
  depth: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf1
   */
  confidence: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf1
   */
  analysisVersion: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf1
   */
  analyzedAt: null
}

/**
 * @export
 */
export const PaletteAnalysisOneOf1StatusEnum = {
  bytes_uploaded: 'bytes_uploaded',
} as const
export type PaletteAnalysisOneOf1StatusEnum =
  (typeof PaletteAnalysisOneOf1StatusEnum)[keyof typeof PaletteAnalysisOneOf1StatusEnum]

/**
 *
 * @export
 * @interface PaletteAnalysisOneOf2
 */
export interface PaletteAnalysisOneOf2 {
  /**
   *
   * @type {PaletteAnalysisOneOf2StatusEnum}
   * @memberof PaletteAnalysisOneOf2
   */
  status: PaletteAnalysisOneOf2StatusEnum
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf2
   */
  failureReason: null
  /**
   *
   * @type {PaletteAnalysisOneOf2SourceEnum}
   * @memberof PaletteAnalysisOneOf2
   */
  source: PaletteAnalysisOneOf2SourceEnum
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf2
   */
  undertone: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf2
   */
  depth: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf2
   */
  confidence: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf2
   */
  analysisVersion: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf2
   */
  analyzedAt: null
}

/**
 * @export
 */
export const PaletteAnalysisOneOf2StatusEnum = {
  processing: 'processing',
} as const
export type PaletteAnalysisOneOf2StatusEnum =
  (typeof PaletteAnalysisOneOf2StatusEnum)[keyof typeof PaletteAnalysisOneOf2StatusEnum]

/**
 * @export
 */
export const PaletteAnalysisOneOf2SourceEnum = {
  selfie: 'selfie',
  wardrobe: 'wardrobe',
} as const
export type PaletteAnalysisOneOf2SourceEnum =
  (typeof PaletteAnalysisOneOf2SourceEnum)[keyof typeof PaletteAnalysisOneOf2SourceEnum]

/**
 *
 * @export
 * @interface PaletteAnalysisOneOf3
 */
export interface PaletteAnalysisOneOf3 {
  /**
   *
   * @type {PaletteAnalysisOneOf3StatusEnum}
   * @memberof PaletteAnalysisOneOf3
   */
  status: PaletteAnalysisOneOf3StatusEnum
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf3
   */
  failureReason: null
  /**
   *
   * @type {PaletteAnalysisOneOf3SourceEnum}
   * @memberof PaletteAnalysisOneOf3
   */
  source: PaletteAnalysisOneOf3SourceEnum
  /**
   *
   * @type {PaletteAnalysisOneOf3UndertoneEnum}
   * @memberof PaletteAnalysisOneOf3
   */
  undertone: PaletteAnalysisOneOf3UndertoneEnum
  /**
   *
   * @type {PaletteAnalysisOneOf3DepthEnum}
   * @memberof PaletteAnalysisOneOf3
   */
  depth: PaletteAnalysisOneOf3DepthEnum | null
  /**
   *
   * @type {number}
   * @memberof PaletteAnalysisOneOf3
   */
  confidence: number
  /**
   *
   * @type {string}
   * @memberof PaletteAnalysisOneOf3
   */
  analysisVersion: string
  /**
   *
   * @type {string}
   * @memberof PaletteAnalysisOneOf3
   */
  analyzedAt: string
}

/**
 * @export
 */
export const PaletteAnalysisOneOf3StatusEnum = {
  ready: 'ready',
} as const
export type PaletteAnalysisOneOf3StatusEnum =
  (typeof PaletteAnalysisOneOf3StatusEnum)[keyof typeof PaletteAnalysisOneOf3StatusEnum]

/**
 * @export
 */
export const PaletteAnalysisOneOf3SourceEnum = {
  selfie: 'selfie',
  wardrobe: 'wardrobe',
} as const
export type PaletteAnalysisOneOf3SourceEnum =
  (typeof PaletteAnalysisOneOf3SourceEnum)[keyof typeof PaletteAnalysisOneOf3SourceEnum]

/**
 * @export
 */
export const PaletteAnalysisOneOf3UndertoneEnum = {
  warm: 'warm',
  cool: 'cool',
  neutral: 'neutral',
  olive: 'olive',
} as const
export type PaletteAnalysisOneOf3UndertoneEnum =
  (typeof PaletteAnalysisOneOf3UndertoneEnum)[keyof typeof PaletteAnalysisOneOf3UndertoneEnum]

/**
 * @export
 */
export const PaletteAnalysisOneOf3DepthEnum = {
  fair: 'fair',
  light: 'light',
  medium: 'medium',
  tan: 'tan',
  deep: 'deep',
} as const
export type PaletteAnalysisOneOf3DepthEnum =
  (typeof PaletteAnalysisOneOf3DepthEnum)[keyof typeof PaletteAnalysisOneOf3DepthEnum]

/**
 *
 * @export
 * @interface PaletteAnalysisOneOf4
 */
export interface PaletteAnalysisOneOf4 {
  /**
   *
   * @type {PaletteAnalysisOneOf4StatusEnum}
   * @memberof PaletteAnalysisOneOf4
   */
  status: PaletteAnalysisOneOf4StatusEnum
  /**
   *
   * @type {PaletteAnalysisOneOf4FailureReasonEnum}
   * @memberof PaletteAnalysisOneOf4
   */
  failureReason: PaletteAnalysisOneOf4FailureReasonEnum
  /**
   *
   * @type {PaletteAnalysisOneOf4SourceEnum}
   * @memberof PaletteAnalysisOneOf4
   */
  source: PaletteAnalysisOneOf4SourceEnum
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf4
   */
  undertone: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf4
   */
  depth: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf4
   */
  confidence: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf4
   */
  analysisVersion: null
  /**
   *
   * @type {null}
   * @memberof PaletteAnalysisOneOf4
   */
  analyzedAt: null
}

/**
 * @export
 */
export const PaletteAnalysisOneOf4StatusEnum = {
  failed: 'failed',
} as const
export type PaletteAnalysisOneOf4StatusEnum =
  (typeof PaletteAnalysisOneOf4StatusEnum)[keyof typeof PaletteAnalysisOneOf4StatusEnum]

/**
 * @export
 */
export const PaletteAnalysisOneOf4FailureReasonEnum = {
  no_face: 'no_face',
  low_quality: 'low_quality',
  privacy_violation: 'privacy_violation',
  insufficient_wardrobe: 'insufficient_wardrobe',
  timeout: 'timeout',
  storage_error: 'storage_error',
} as const
export type PaletteAnalysisOneOf4FailureReasonEnum =
  (typeof PaletteAnalysisOneOf4FailureReasonEnum)[keyof typeof PaletteAnalysisOneOf4FailureReasonEnum]

/**
 * @export
 */
export const PaletteAnalysisOneOf4SourceEnum = {
  selfie: 'selfie',
  wardrobe: 'wardrobe',
} as const
export type PaletteAnalysisOneOf4SourceEnum =
  (typeof PaletteAnalysisOneOf4SourceEnum)[keyof typeof PaletteAnalysisOneOf4SourceEnum]

/**
 *
 * @export
 */
export const PaletteAnalysisStatus = {
  pending_upload: 'pending_upload',
  bytes_uploaded: 'bytes_uploaded',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed',
} as const
export type PaletteAnalysisStatus =
  (typeof PaletteAnalysisStatus)[keyof typeof PaletteAnalysisStatus]

/**
 *
 * @export
 */
export const PaletteSource = {
  selfie: 'selfie',
  wardrobe: 'wardrobe',
} as const
export type PaletteSource = (typeof PaletteSource)[keyof typeof PaletteSource]

/**
 *
 * @export
 * @interface PolledEvent
 */
export interface PolledEvent {
  /**
   *
   * @type {string}
   * @memberof PolledEvent
   */
  id: string
  /**
   *
   * @type {string}
   * @memberof PolledEvent
   */
  channel: string
  /**
   *
   * @type {any}
   * @memberof PolledEvent
   */
  payload?: any | null
  /**
   *
   * @type {string}
   * @memberof PolledEvent
   */
  userId: string | null
  /**
   *
   * @type {string}
   * @memberof PolledEvent
   */
  createdAt: string
}
/**
 *
 * @export
 * @interface PortalSessionResponse
 */
export interface PortalSessionResponse {
  /**
   *
   * @type {PortalSessionResponseData}
   * @memberof PortalSessionResponse
   */
  data: PortalSessionResponseData
}
/**
 *
 * @export
 * @interface PortalSessionResponseData
 */
export interface PortalSessionResponseData {
  /**
   * Stripe Customer Portal URL. Cancel, upgrade, and downgrade for web-managed subscriptions happen there, never in hand-built UI.
   * @type {string}
   * @memberof PortalSessionResponseData
   */
  url: string
}

/**
 *
 * @export
 */
export const PrecipPreparedness = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type PrecipPreparedness =
  (typeof PrecipPreparedness)[keyof typeof PrecipPreparedness]

/**
 *
 * @export
 * @interface PremiumTheme
 */
export interface PremiumTheme {
  /**
   * The palette to render, already resolved server-side. null is the Default monochrome-and-gold system, which is also what a non-entitled caller reads regardless of what is stored.
   * @type {PremiumThemeThemeEnum}
   * @memberof PremiumTheme
   */
  theme: PremiumThemeThemeEnum | null
  /**
   * Whether the acting user currently passes the premium entitlement check. False forces theme to null in the same response, so a client never has to combine entitlement with preference itself.
   * @type {boolean}
   * @memberof PremiumTheme
   */
  isEntitled: boolean
  /**
   * Server-evaluated premium_themes_enabled flag. The only flag exposure path: clients render the gallery as selectable only when true. Reading the current theme stays available regardless.
   * @type {boolean}
   * @memberof PremiumTheme
   */
  themesEnabled: boolean
}

/**
 * @export
 */
export const PremiumThemeThemeEnum = {
  jewel_radiance: 'jewel_radiance',
  autumn_umber: 'autumn_umber',
  winter_metallic: 'winter_metallic',
} as const
export type PremiumThemeThemeEnum =
  (typeof PremiumThemeThemeEnum)[keyof typeof PremiumThemeThemeEnum]

/**
 *
 * @export
 */
export const PremiumThemeKey = {
  jewel_radiance: 'jewel_radiance',
  autumn_umber: 'autumn_umber',
  winter_metallic: 'winter_metallic',
} as const
export type PremiumThemeKey = (typeof PremiumThemeKey)[keyof typeof PremiumThemeKey]

/**
 *
 * @export
 * @interface PremiumThemeResponse
 */
export interface PremiumThemeResponse {
  /**
   *
   * @type {PremiumThemeResponseData}
   * @memberof PremiumThemeResponse
   */
  data: PremiumThemeResponseData
}
/**
 *
 * @export
 * @interface PremiumThemeResponseData
 */
export interface PremiumThemeResponseData {
  /**
   * The palette to render, already resolved server-side. null is the Default monochrome-and-gold system, which is also what a non-entitled caller reads regardless of what is stored.
   * @type {PremiumThemeResponseDataThemeEnum}
   * @memberof PremiumThemeResponseData
   */
  theme: PremiumThemeResponseDataThemeEnum | null
  /**
   * Whether the acting user currently passes the premium entitlement check. False forces theme to null in the same response, so a client never has to combine entitlement with preference itself.
   * @type {boolean}
   * @memberof PremiumThemeResponseData
   */
  isEntitled: boolean
  /**
   * Server-evaluated premium_themes_enabled flag. The only flag exposure path: clients render the gallery as selectable only when true. Reading the current theme stays available regardless.
   * @type {boolean}
   * @memberof PremiumThemeResponseData
   */
  themesEnabled: boolean
}

/**
 * @export
 */
export const PremiumThemeResponseDataThemeEnum = {
  jewel_radiance: 'jewel_radiance',
  autumn_umber: 'autumn_umber',
  winter_metallic: 'winter_metallic',
} as const
export type PremiumThemeResponseDataThemeEnum =
  (typeof PremiumThemeResponseDataThemeEnum)[keyof typeof PremiumThemeResponseDataThemeEnum]

/**
 *
 * @export
 * @interface QueueHealthResponse
 */
export interface QueueHealthResponse {
  /**
   *
   * @type {QueueHealthResponseStatusEnum}
   * @memberof QueueHealthResponse
   */
  status: QueueHealthResponseStatusEnum
  /**
   *
   * @type {Array<string>}
   * @memberof QueueHealthResponse
   */
  queues: Array<string>
  /**
   *
   * @type {ApiV1HealthQueuesGet200ResponseMetrics}
   * @memberof QueueHealthResponse
   */
  metrics: ApiV1HealthQueuesGet200ResponseMetrics
}

/**
 * @export
 */
export const QueueHealthResponseStatusEnum = {
  ok: 'ok',
} as const
export type QueueHealthResponseStatusEnum =
  (typeof QueueHealthResponseStatusEnum)[keyof typeof QueueHealthResponseStatusEnum]

/**
 *
 * @export
 * @interface QueueMetrics
 */
export interface QueueMetrics {
  /**
   *
   * @type {number}
   * @memberof QueueMetrics
   */
  waiting?: number
  /**
   *
   * @type {number}
   * @memberof QueueMetrics
   */
  active?: number
  /**
   *
   * @type {number}
   * @memberof QueueMetrics
   */
  completed?: number
  /**
   *
   * @type {number}
   * @memberof QueueMetrics
   */
  failed?: number
  /**
   *
   * @type {number}
   * @memberof QueueMetrics
   */
  delayed?: number
  /**
   *
   * @type {number}
   * @memberof QueueMetrics
   */
  paused?: number
}
/**
 *
 * @export
 * @interface RitualQueryParams
 */
export interface RitualQueryParams {
  /**
   * Optional ID of a saved user location key or preferences reference.
   * @type {string}
   * @memberof RitualQueryParams
   */
  locationId?: string
  /**
   * Optional locale override for this localized ritual response.
   * @type {RitualQueryParamsLocaleEnum}
   * @memberof RitualQueryParams
   */
  locale?: RitualQueryParamsLocaleEnum
  /**
   * Optional occasion filter for capsule recommendations.
   * @type {RitualQueryParamsOccasionEnum}
   * @memberof RitualQueryParams
   */
  occasion?: RitualQueryParamsOccasionEnum
}

/**
 * @export
 */
export const RitualQueryParamsLocaleEnum = {
  en_US: 'en-US',
  en_CA: 'en-CA',
  es_419: 'es-419',
  fr_CA: 'fr-CA',
  fr_FR: 'fr-FR',
  tr_TR: 'tr-TR',
  de_DE: 'de-DE',
  it_IT: 'it-IT',
  pt_BR: 'pt-BR',
  pt_PT: 'pt-PT',
} as const
export type RitualQueryParamsLocaleEnum =
  (typeof RitualQueryParamsLocaleEnum)[keyof typeof RitualQueryParamsLocaleEnum]

/**
 * @export
 */
export const RitualQueryParamsOccasionEnum = {
  work: 'work',
  casual: 'casual',
  formal: 'formal',
  sport: 'sport',
  travel: 'travel',
  evening: 'evening',
  outdoor: 'outdoor',
  home: 'home',
} as const
export type RitualQueryParamsOccasionEnum =
  (typeof RitualQueryParamsOccasionEnum)[keyof typeof RitualQueryParamsOccasionEnum]

/**
 *
 * @export
 * @interface RitualResponse
 */
export interface RitualResponse {
  /**
   *
   * @type {RitualResponseData}
   * @memberof RitualResponse
   */
  data: RitualResponseData
}
/**
 *
 * @export
 * @interface RitualResponseData
 */
export interface RitualResponseData {
  /**
   *
   * @type {LatestWeatherResponseDataOneOfWeather}
   * @memberof RitualResponseData
   */
  weather: LatestWeatherResponseDataOneOfWeather
  /**
   * Collection invariant enforced at runtime and NOT expressible in this schema: the three outfits always cover three distinct scenarios (morning, midday, evening), one each. The server never emits a repeated scenario, so consumers may key on scenario without deduplicating, and fixtures must not repeat one.
   * @type {Array<RitualResponseDataOutfitsInner>}
   * @memberof RitualResponseData
   */
  outfits: Array<RitualResponseDataOutfitsInner>
  /**
   *
   * @type {Array<string>}
   * @memberof RitualResponseData
   */
  badges: Array<string>
}
/**
 *
 * @export
 * @interface RitualResponseDataOutfitsInner
 */
export interface RitualResponseDataOutfitsInner {
  /**
   * Unique identifier for the recommendation card.
   * @type {string}
   * @memberof RitualResponseDataOutfitsInner
   */
  id: string
  /**
   * The daily scenario: morning, midday, or evening.
   * @type {RitualResponseDataOutfitsInnerScenarioEnum}
   * @memberof RitualResponseDataOutfitsInner
   */
  scenario: RitualResponseDataOutfitsInnerScenarioEnum
  /**
   * The custom or fallback garment identifiers suggested.
   * @type {Array<string>}
   * @memberof RitualResponseDataOutfitsInner
   */
  garmentIds: Array<string>
  /**
   * Reasoning badges justifying the garments chosen.
   * @type {Array<ScenarioOutfitReasoningBadgesInner>}
   * @memberof RitualResponseDataOutfitsInner
   */
  reasoningBadges: Array<ScenarioOutfitReasoningBadgesInner>
  /**
   * Explanation string based on weather and comfort thresholds.
   * @type {string}
   * @memberof RitualResponseDataOutfitsInner
   */
  comfortNotes: string
  /**
   * Optional capsule ID if recommendation came from an outfit capsule.
   * @type {string}
   * @memberof RitualResponseDataOutfitsInner
   */
  capsuleId?: string | null
  /**
   * Optional capsule name if recommendation came from an outfit capsule.
   * @type {string}
   * @memberof RitualResponseDataOutfitsInner
   */
  capsuleName?: string | null
  /**
   * Optional list of garment IDs auto-filled into a partial capsule.
   * @type {Array<string>}
   * @memberof RitualResponseDataOutfitsInner
   */
  autoFilledGarmentIds?: Array<string>
  /**
   *
   * @type {ScenarioOutfitShopThisLook}
   * @memberof RitualResponseDataOutfitsInner
   */
  shopThisLook: ScenarioOutfitShopThisLook
}

/**
 * @export
 */
export const RitualResponseDataOutfitsInnerScenarioEnum = {
  morning: 'morning',
  midday: 'midday',
  evening: 'evening',
} as const
export type RitualResponseDataOutfitsInnerScenarioEnum =
  (typeof RitualResponseDataOutfitsInnerScenarioEnum)[keyof typeof RitualResponseDataOutfitsInnerScenarioEnum]

/**
 *
 * @export
 * @interface SavedLocation
 */
export interface SavedLocation {
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  id: string
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  label: string
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  locationKey: string
  /**
   *
   * @type {number}
   * @memberof SavedLocation
   */
  latitude: number
  /**
   *
   * @type {number}
   * @memberof SavedLocation
   */
  longitude: number
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  timezone: string
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  city: string | null
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  region: string | null
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  country: string | null
  /**
   *
   * @type {boolean}
   * @memberof SavedLocation
   */
  isPrimary: boolean
  /**
   *
   * @type {number}
   * @memberof SavedLocation
   */
  sortOrder: number
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  createdAt: string
  /**
   *
   * @type {string}
   * @memberof SavedLocation
   */
  updatedAt: string
}
/**
 *
 * @export
 * @interface SavedLocationIdPathParams
 */
export interface SavedLocationIdPathParams {
  /**
   * Saved location ID.
   * @type {string}
   * @memberof SavedLocationIdPathParams
   */
  locationId: string
}

/**
 *
 * @export
 */
export const ScenarioName = {
  morning: 'morning',
  midday: 'midday',
  evening: 'evening',
} as const
export type ScenarioName = (typeof ScenarioName)[keyof typeof ScenarioName]

/**
 *
 * @export
 * @interface ScenarioOutfit
 */
export interface ScenarioOutfit {
  /**
   * Unique identifier for the recommendation card.
   * @type {string}
   * @memberof ScenarioOutfit
   */
  id: string
  /**
   * The daily scenario: morning, midday, or evening.
   * @type {ScenarioOutfitScenarioEnum}
   * @memberof ScenarioOutfit
   */
  scenario: ScenarioOutfitScenarioEnum
  /**
   * The custom or fallback garment identifiers suggested.
   * @type {Array<string>}
   * @memberof ScenarioOutfit
   */
  garmentIds: Array<string>
  /**
   * Reasoning badges justifying the garments chosen.
   * @type {Array<ScenarioOutfitReasoningBadgesInner>}
   * @memberof ScenarioOutfit
   */
  reasoningBadges: Array<ScenarioOutfitReasoningBadgesInner>
  /**
   * Explanation string based on weather and comfort thresholds.
   * @type {string}
   * @memberof ScenarioOutfit
   */
  comfortNotes: string
  /**
   * Optional capsule ID if recommendation came from an outfit capsule.
   * @type {string}
   * @memberof ScenarioOutfit
   */
  capsuleId?: string | null
  /**
   * Optional capsule name if recommendation came from an outfit capsule.
   * @type {string}
   * @memberof ScenarioOutfit
   */
  capsuleName?: string | null
  /**
   * Optional list of garment IDs auto-filled into a partial capsule.
   * @type {Array<string>}
   * @memberof ScenarioOutfit
   */
  autoFilledGarmentIds?: Array<string>
  /**
   *
   * @type {ScenarioOutfitShopThisLook}
   * @memberof ScenarioOutfit
   */
  shopThisLook: ScenarioOutfitShopThisLook
}

/**
 * @export
 */
export const ScenarioOutfitScenarioEnum = {
  morning: 'morning',
  midday: 'midday',
  evening: 'evening',
} as const
export type ScenarioOutfitScenarioEnum =
  (typeof ScenarioOutfitScenarioEnum)[keyof typeof ScenarioOutfitScenarioEnum]

/**
 *
 * @export
 * @interface ScenarioOutfitReasoningBadgesInner
 */
export interface ScenarioOutfitReasoningBadgesInner {
  /**
   * Unique key for the badge.
   * @type {string}
   * @memberof ScenarioOutfitReasoningBadgesInner
   */
  key: string
  /**
   * Localized default label for the badge.
   * @type {string}
   * @memberof ScenarioOutfitReasoningBadgesInner
   */
  label: string
  /**
   * Explanatory bullet points explaining why the badge triggered.
   * @type {Array<string>}
   * @memberof ScenarioOutfitReasoningBadgesInner
   */
  bullets: Array<string>
}
/**
 * Always present. null means the acting user is not eligible for an affiliate CTA on this card, for any reason: the feature flag is off, the user opted out, or no active in-window offer matched a slot. Never populated from a cached payload.
 * @export
 * @interface ScenarioOutfitShopThisLook
 */
export interface ScenarioOutfitShopThisLook {
  /**
   * CommercePartner.slug. Stable, safe to log.
   * @type {string}
   * @memberof ScenarioOutfitShopThisLook
   */
  partnerId: string
  /**
   * Rendered next to the CTA.
   * @type {string}
   * @memberof ScenarioOutfitShopThisLook
   */
  partnerDisplayName: string
  /**
   * Pass back to POST /api/v1/commerce/affiliate/clicks.
   * @type {string}
   * @memberof ScenarioOutfitShopThisLook
   */
  offerId: string
  /**
   * Partner-authored, already localized by the catalog row.
   * @type {string}
   * @memberof ScenarioOutfitShopThisLook
   */
  offerTitle: string
  /**
   * The outfit slot this offer matched.
   * @type {ScenarioOutfitShopThisLookGarmentCategoryEnum}
   * @memberof ScenarioOutfitShopThisLook
   */
  garmentCategory: ScenarioOutfitShopThisLookGarmentCategoryEnum | null
}

/**
 * @export
 */
export const ScenarioOutfitShopThisLookGarmentCategoryEnum = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  dress: 'dress',
  shoes: 'shoes',
  accessory: 'accessory',
} as const
export type ScenarioOutfitShopThisLookGarmentCategoryEnum =
  (typeof ScenarioOutfitShopThisLookGarmentCategoryEnum)[keyof typeof ScenarioOutfitShopThisLookGarmentCategoryEnum]

/**
 *
 * @export
 * @interface ServiceUnavailableHttpError
 */
export interface ServiceUnavailableHttpError {
  /**
   *
   * @type {ServiceUnavailableHttpErrorStatusCodeEnum}
   * @memberof ServiceUnavailableHttpError
   */
  statusCode: ServiceUnavailableHttpErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof ServiceUnavailableHttpError
   */
  message: string
  /**
   *
   * @type {ServiceUnavailableHttpErrorErrorEnum}
   * @memberof ServiceUnavailableHttpError
   */
  error: ServiceUnavailableHttpErrorErrorEnum
}

/**
 * @export
 */
export const ServiceUnavailableHttpErrorStatusCodeEnum = {
  NUMBER_503: 503,
} as const
export type ServiceUnavailableHttpErrorStatusCodeEnum =
  (typeof ServiceUnavailableHttpErrorStatusCodeEnum)[keyof typeof ServiceUnavailableHttpErrorStatusCodeEnum]

/**
 * @export
 */
export const ServiceUnavailableHttpErrorErrorEnum = {
  Service_Unavailable: 'Service Unavailable',
} as const
export type ServiceUnavailableHttpErrorErrorEnum =
  (typeof ServiceUnavailableHttpErrorErrorEnum)[keyof typeof ServiceUnavailableHttpErrorErrorEnum]

/**
 *
 * @export
 * @interface SetPaletteConsentInput
 */
export interface SetPaletteConsentInput {
  /**
   * true grants consent; false revokes it and erases the palette.
   * @type {boolean}
   * @memberof SetPaletteConsentInput
   */
  granted: boolean
}
/**
 *
 * @export
 * @interface SetPaletteConsentResponse
 */
export interface SetPaletteConsentResponse {
  /**
   *
   * @type {PaletteAdvisorProfileResponseData}
   * @memberof SetPaletteConsentResponse
   */
  data: PaletteAdvisorProfileResponseData
}
/**
 *
 * @export
 * @interface SetPrimarySavedLocationResponse
 */
export interface SetPrimarySavedLocationResponse {
  /**
   *
   * @type {ListSavedLocationsResponseDataInner}
   * @memberof SetPrimarySavedLocationResponse
   */
  data: ListSavedLocationsResponseDataInner
}
/**
 *
 * @export
 * @interface ShopThisLook
 */
export interface ShopThisLook {
  /**
   * CommercePartner.slug. Stable, safe to log.
   * @type {string}
   * @memberof ShopThisLook
   */
  partnerId: string
  /**
   * Rendered next to the CTA.
   * @type {string}
   * @memberof ShopThisLook
   */
  partnerDisplayName: string
  /**
   * Pass back to POST /api/v1/commerce/affiliate/clicks.
   * @type {string}
   * @memberof ShopThisLook
   */
  offerId: string
  /**
   * Partner-authored, already localized by the catalog row.
   * @type {string}
   * @memberof ShopThisLook
   */
  offerTitle: string
  /**
   * The outfit slot this offer matched.
   * @type {ShopThisLookGarmentCategoryEnum}
   * @memberof ShopThisLook
   */
  garmentCategory: ShopThisLookGarmentCategoryEnum | null
}

/**
 * @export
 */
export const ShopThisLookGarmentCategoryEnum = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  dress: 'dress',
  shoes: 'shoes',
  accessory: 'accessory',
} as const
export type ShopThisLookGarmentCategoryEnum =
  (typeof ShopThisLookGarmentCategoryEnum)[keyof typeof ShopThisLookGarmentCategoryEnum]

/**
 *
 * @export
 * @interface SignupInput
 */
export interface SignupInput {
  /**
   *
   * @type {string}
   * @memberof SignupInput
   */
  email: string
  /**
   * Invariant enforced at runtime and NOT expressible in this schema: beyond the YYYY-MM-DD pattern, the value must be a real calendar date. The pattern alone accepts 2026-02-31 and 2026-13-01; both are rejected here.
   * @type {string}
   * @memberof SignupInput
   */
  birthdate: string
}
/**
 * @type SignupResponse
 * guardianConsentRequired is a function of accountStatus, never independent of it, so each variant fixes both together. Treat accountStatus as the source of truth; a response where the two disagree is unrepresentable.
 * @export
 */
export type SignupResponse = SignupResponseOneOf | SignupResponseOneOf1
/**
 *
 * @export
 * @interface SignupResponseOneOf
 */
export interface SignupResponseOneOf {
  /**
   *
   * @type {string}
   * @memberof SignupResponseOneOf
   */
  userId: string
  /**
   *
   * @type {number}
   * @memberof SignupResponseOneOf
   */
  age: number
  /**
   *
   * @type {SignupResponseOneOfAccountStatusEnum}
   * @memberof SignupResponseOneOf
   */
  accountStatus: SignupResponseOneOfAccountStatusEnum
  /**
   *
   * @type {SignupResponseOneOfGuardianConsentRequiredEnum}
   * @memberof SignupResponseOneOf
   */
  guardianConsentRequired: SignupResponseOneOfGuardianConsentRequiredEnum
}

/**
 * @export
 */
export const SignupResponseOneOfAccountStatusEnum = {
  active: 'active',
} as const
export type SignupResponseOneOfAccountStatusEnum =
  (typeof SignupResponseOneOfAccountStatusEnum)[keyof typeof SignupResponseOneOfAccountStatusEnum]

/**
 * @export
 */
export const SignupResponseOneOfGuardianConsentRequiredEnum = {
  false: false,
} as const
export type SignupResponseOneOfGuardianConsentRequiredEnum =
  (typeof SignupResponseOneOfGuardianConsentRequiredEnum)[keyof typeof SignupResponseOneOfGuardianConsentRequiredEnum]

/**
 *
 * @export
 * @interface SignupResponseOneOf1
 */
export interface SignupResponseOneOf1 {
  /**
   *
   * @type {string}
   * @memberof SignupResponseOneOf1
   */
  userId: string
  /**
   *
   * @type {number}
   * @memberof SignupResponseOneOf1
   */
  age: number
  /**
   *
   * @type {SignupResponseOneOf1AccountStatusEnum}
   * @memberof SignupResponseOneOf1
   */
  accountStatus: SignupResponseOneOf1AccountStatusEnum
  /**
   *
   * @type {SignupResponseOneOf1GuardianConsentRequiredEnum}
   * @memberof SignupResponseOneOf1
   */
  guardianConsentRequired: SignupResponseOneOf1GuardianConsentRequiredEnum
}

/**
 * @export
 */
export const SignupResponseOneOf1AccountStatusEnum = {
  pending_guardian_consent: 'pending_guardian_consent',
} as const
export type SignupResponseOneOf1AccountStatusEnum =
  (typeof SignupResponseOneOf1AccountStatusEnum)[keyof typeof SignupResponseOneOf1AccountStatusEnum]

/**
 * @export
 */
export const SignupResponseOneOf1GuardianConsentRequiredEnum = {
  true: true,
} as const
export type SignupResponseOneOf1GuardianConsentRequiredEnum =
  (typeof SignupResponseOneOf1GuardianConsentRequiredEnum)[keyof typeof SignupResponseOneOf1GuardianConsentRequiredEnum]

/**
 *
 * @export
 * @interface SilhouetteBadRequestError
 */
export interface SilhouetteBadRequestError {
  /**
   *
   * @type {SilhouetteBadRequestErrorStatusCodeEnum}
   * @memberof SilhouetteBadRequestError
   */
  statusCode: SilhouetteBadRequestErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof SilhouetteBadRequestError
   */
  message: string
  /**
   *
   * @type {SilhouetteBadRequestErrorErrorEnum}
   * @memberof SilhouetteBadRequestError
   */
  error: SilhouetteBadRequestErrorErrorEnum
}

/**
 * @export
 */
export const SilhouetteBadRequestErrorStatusCodeEnum = {
  NUMBER_400: 400,
} as const
export type SilhouetteBadRequestErrorStatusCodeEnum =
  (typeof SilhouetteBadRequestErrorStatusCodeEnum)[keyof typeof SilhouetteBadRequestErrorStatusCodeEnum]

/**
 * @export
 */
export const SilhouetteBadRequestErrorErrorEnum = {
  Bad_Request: 'Bad Request',
} as const
export type SilhouetteBadRequestErrorErrorEnum =
  (typeof SilhouetteBadRequestErrorErrorEnum)[keyof typeof SilhouetteBadRequestErrorErrorEnum]

/**
 *
 * @export
 * @interface SilhouetteConflictError
 */
export interface SilhouetteConflictError {
  /**
   *
   * @type {SilhouetteConflictErrorStatusCodeEnum}
   * @memberof SilhouetteConflictError
   */
  statusCode: SilhouetteConflictErrorStatusCodeEnum
  /**
   *
   * @type {SilhouetteConflictErrorMessageEnum}
   * @memberof SilhouetteConflictError
   */
  message: SilhouetteConflictErrorMessageEnum
  /**
   *
   * @type {SilhouetteConflictErrorErrorEnum}
   * @memberof SilhouetteConflictError
   */
  error: SilhouetteConflictErrorErrorEnum
}

/**
 * @export
 */
export const SilhouetteConflictErrorStatusCodeEnum = {
  NUMBER_409: 409,
} as const
export type SilhouetteConflictErrorStatusCodeEnum =
  (typeof SilhouetteConflictErrorStatusCodeEnum)[keyof typeof SilhouetteConflictErrorStatusCodeEnum]

/**
 * @export
 */
export const SilhouetteConflictErrorMessageEnum = {
  CONFIRM_BASEWEAR_GUIDANCE_REQUIRED: 'CONFIRM_BASEWEAR_GUIDANCE_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
} as const
export type SilhouetteConflictErrorMessageEnum =
  (typeof SilhouetteConflictErrorMessageEnum)[keyof typeof SilhouetteConflictErrorMessageEnum]

/**
 * @export
 */
export const SilhouetteConflictErrorErrorEnum = {
  Conflict: 'Conflict',
} as const
export type SilhouetteConflictErrorErrorEnum =
  (typeof SilhouetteConflictErrorErrorEnum)[keyof typeof SilhouetteConflictErrorErrorEnum]

/**
 *
 * @export
 * @interface SilhouetteForbiddenError
 */
export interface SilhouetteForbiddenError {
  /**
   *
   * @type {SilhouetteForbiddenErrorStatusCodeEnum}
   * @memberof SilhouetteForbiddenError
   */
  statusCode: SilhouetteForbiddenErrorStatusCodeEnum
  /**
   *
   * @type {SilhouetteForbiddenErrorMessageEnum}
   * @memberof SilhouetteForbiddenError
   */
  message: SilhouetteForbiddenErrorMessageEnum
  /**
   *
   * @type {SilhouetteForbiddenErrorErrorEnum}
   * @memberof SilhouetteForbiddenError
   */
  error: SilhouetteForbiddenErrorErrorEnum
}

/**
 * @export
 */
export const SilhouetteForbiddenErrorStatusCodeEnum = {
  NUMBER_403: 403,
} as const
export type SilhouetteForbiddenErrorStatusCodeEnum =
  (typeof SilhouetteForbiddenErrorStatusCodeEnum)[keyof typeof SilhouetteForbiddenErrorStatusCodeEnum]

/**
 * @export
 */
export const SilhouetteForbiddenErrorMessageEnum = {
  GUARDIAN_READ_ONLY: 'GUARDIAN_READ_ONLY',
  GUARDIAN_CONSENT_REQUIRED: 'GUARDIAN_CONSENT_REQUIRED',
} as const
export type SilhouetteForbiddenErrorMessageEnum =
  (typeof SilhouetteForbiddenErrorMessageEnum)[keyof typeof SilhouetteForbiddenErrorMessageEnum]

/**
 * @export
 */
export const SilhouetteForbiddenErrorErrorEnum = {
  Forbidden: 'Forbidden',
} as const
export type SilhouetteForbiddenErrorErrorEnum =
  (typeof SilhouetteForbiddenErrorErrorEnum)[keyof typeof SilhouetteForbiddenErrorErrorEnum]

/**
 *
 * @export
 * @interface SilhouetteNotFoundError
 */
export interface SilhouetteNotFoundError {
  /**
   *
   * @type {SilhouetteNotFoundErrorStatusCodeEnum}
   * @memberof SilhouetteNotFoundError
   */
  statusCode: SilhouetteNotFoundErrorStatusCodeEnum
  /**
   *
   * @type {SilhouetteNotFoundErrorMessageEnum}
   * @memberof SilhouetteNotFoundError
   */
  message: SilhouetteNotFoundErrorMessageEnum
  /**
   *
   * @type {SilhouetteNotFoundErrorErrorEnum}
   * @memberof SilhouetteNotFoundError
   */
  error: SilhouetteNotFoundErrorErrorEnum
}

/**
 * @export
 */
export const SilhouetteNotFoundErrorStatusCodeEnum = {
  NUMBER_404: 404,
} as const
export type SilhouetteNotFoundErrorStatusCodeEnum =
  (typeof SilhouetteNotFoundErrorStatusCodeEnum)[keyof typeof SilhouetteNotFoundErrorStatusCodeEnum]

/**
 * @export
 */
export const SilhouetteNotFoundErrorMessageEnum = {
  NOT_FOUND: 'NOT_FOUND',
} as const
export type SilhouetteNotFoundErrorMessageEnum =
  (typeof SilhouetteNotFoundErrorMessageEnum)[keyof typeof SilhouetteNotFoundErrorMessageEnum]

/**
 * @export
 */
export const SilhouetteNotFoundErrorErrorEnum = {
  Not_Found: 'Not Found',
} as const
export type SilhouetteNotFoundErrorErrorEnum =
  (typeof SilhouetteNotFoundErrorErrorEnum)[keyof typeof SilhouetteNotFoundErrorErrorEnum]

/**
 *
 * @export
 * @interface SilhouettePreconditionFailedError
 */
export interface SilhouettePreconditionFailedError {
  /**
   *
   * @type {SilhouettePreconditionFailedErrorStatusCodeEnum}
   * @memberof SilhouettePreconditionFailedError
   */
  statusCode: SilhouettePreconditionFailedErrorStatusCodeEnum
  /**
   *
   * @type {SilhouettePreconditionFailedErrorMessageEnum}
   * @memberof SilhouettePreconditionFailedError
   */
  message: SilhouettePreconditionFailedErrorMessageEnum
  /**
   *
   * @type {SilhouettePreconditionFailedErrorErrorEnum}
   * @memberof SilhouettePreconditionFailedError
   */
  error: SilhouettePreconditionFailedErrorErrorEnum
}

/**
 * @export
 */
export const SilhouettePreconditionFailedErrorStatusCodeEnum = {
  NUMBER_412: 412,
} as const
export type SilhouettePreconditionFailedErrorStatusCodeEnum =
  (typeof SilhouettePreconditionFailedErrorStatusCodeEnum)[keyof typeof SilhouettePreconditionFailedErrorStatusCodeEnum]

/**
 * @export
 */
export const SilhouettePreconditionFailedErrorMessageEnum = {
  SILHOUETTE_REVISION_MISMATCH: 'SILHOUETTE_REVISION_MISMATCH',
} as const
export type SilhouettePreconditionFailedErrorMessageEnum =
  (typeof SilhouettePreconditionFailedErrorMessageEnum)[keyof typeof SilhouettePreconditionFailedErrorMessageEnum]

/**
 * @export
 */
export const SilhouettePreconditionFailedErrorErrorEnum = {
  Precondition_Failed: 'Precondition Failed',
} as const
export type SilhouettePreconditionFailedErrorErrorEnum =
  (typeof SilhouettePreconditionFailedErrorErrorEnum)[keyof typeof SilhouettePreconditionFailedErrorErrorEnum]

/**
 *
 * @export
 * @interface SilhouettePreconditionRequiredError
 */
export interface SilhouettePreconditionRequiredError {
  /**
   *
   * @type {SilhouettePreconditionRequiredErrorStatusCodeEnum}
   * @memberof SilhouettePreconditionRequiredError
   */
  statusCode: SilhouettePreconditionRequiredErrorStatusCodeEnum
  /**
   *
   * @type {SilhouettePreconditionRequiredErrorMessageEnum}
   * @memberof SilhouettePreconditionRequiredError
   */
  message: SilhouettePreconditionRequiredErrorMessageEnum
  /**
   *
   * @type {SilhouettePreconditionRequiredErrorErrorEnum}
   * @memberof SilhouettePreconditionRequiredError
   */
  error?: SilhouettePreconditionRequiredErrorErrorEnum
}

/**
 * @export
 */
export const SilhouettePreconditionRequiredErrorStatusCodeEnum = {
  NUMBER_428: 428,
} as const
export type SilhouettePreconditionRequiredErrorStatusCodeEnum =
  (typeof SilhouettePreconditionRequiredErrorStatusCodeEnum)[keyof typeof SilhouettePreconditionRequiredErrorStatusCodeEnum]

/**
 * @export
 */
export const SilhouettePreconditionRequiredErrorMessageEnum = {
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
} as const
export type SilhouettePreconditionRequiredErrorMessageEnum =
  (typeof SilhouettePreconditionRequiredErrorMessageEnum)[keyof typeof SilhouettePreconditionRequiredErrorMessageEnum]

/**
 * @export
 */
export const SilhouettePreconditionRequiredErrorErrorEnum = {
  Precondition_Required: 'Precondition Required',
} as const
export type SilhouettePreconditionRequiredErrorErrorEnum =
  (typeof SilhouettePreconditionRequiredErrorErrorEnum)[keyof typeof SilhouettePreconditionRequiredErrorErrorEnum]

/**
 *
 * @export
 * @interface SilhouetteProfileResponse
 */
export interface SilhouetteProfileResponse {
  /**
   *
   * @type {SilhouetteProfileResponseData}
   * @memberof SilhouetteProfileResponse
   */
  data: SilhouetteProfileResponseData
}
/**
 *
 * @export
 * @interface SilhouetteProfileResponseData
 */
export interface SilhouetteProfileResponseData {
  /**
   *
   * @type {SilhouetteProfileResponseDataModeEnum}
   * @memberof SilhouetteProfileResponseData
   */
  mode: SilhouetteProfileResponseDataModeEnum
  /**
   *
   * @type {number}
   * @memberof SilhouetteProfileResponseData
   */
  heightSlider: number | null
  /**
   *
   * @type {number}
   * @memberof SilhouetteProfileResponseData
   */
  buildSlider: number | null
  /**
   *
   * @type {SilhouetteProfileResponseDataMyForm}
   * @memberof SilhouetteProfileResponseData
   */
  myForm: SilhouetteProfileResponseDataMyForm | null
  /**
   *
   * @type {number}
   * @memberof SilhouetteProfileResponseData
   */
  revision: number
  /**
   *
   * @type {string}
   * @memberof SilhouetteProfileResponseData
   */
  updatedAt: string
}

/**
 * @export
 */
export const SilhouetteProfileResponseDataModeEnum = {
  default_mannequin: 'default_mannequin',
  my_form: 'my_form',
} as const
export type SilhouetteProfileResponseDataModeEnum =
  (typeof SilhouetteProfileResponseDataModeEnum)[keyof typeof SilhouetteProfileResponseDataModeEnum]

/**
 * @type SilhouetteProfileResponseDataMyForm
 * One variant per photo status. committedAt is present exactly on the committed statuses, failureReason exactly on failed, and imageAccess exactly on ready. Expressing this as variants rather than an invisible runtime check means a combination such as a ready photo with a null imageAccess is unrepresentable in the generated types.
 * @export
 */
export type SilhouetteProfileResponseDataMyForm =
  | SilhouetteProfileResponseDataMyFormOneOf
  | SilhouetteProfileResponseDataMyFormOneOf1
  | SilhouetteProfileResponseDataMyFormOneOf2
  | SilhouetteProfileResponseDataMyFormOneOf3
  | SilhouetteProfileResponseDataMyFormOneOf4
/**
 *
 * @export
 * @interface SilhouetteProfileResponseDataMyFormOneOf
 */
export interface SilhouetteProfileResponseDataMyFormOneOf {
  /**
   *
   * @type {SilhouetteProfileResponseDataMyFormOneOfStatusEnum}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf
   */
  status: SilhouetteProfileResponseDataMyFormOneOfStatusEnum
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf
   */
  failureReason: null
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf
   */
  committedAt: null
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf
   */
  imageAccess: null
}

/**
 * @export
 */
export const SilhouetteProfileResponseDataMyFormOneOfStatusEnum = {
  pending_upload: 'pending_upload',
} as const
export type SilhouetteProfileResponseDataMyFormOneOfStatusEnum =
  (typeof SilhouetteProfileResponseDataMyFormOneOfStatusEnum)[keyof typeof SilhouetteProfileResponseDataMyFormOneOfStatusEnum]

/**
 *
 * @export
 * @interface SilhouetteProfileResponseDataMyFormOneOf1
 */
export interface SilhouetteProfileResponseDataMyFormOneOf1 {
  /**
   *
   * @type {SilhouetteProfileResponseDataMyFormOneOf1StatusEnum}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf1
   */
  status: SilhouetteProfileResponseDataMyFormOneOf1StatusEnum
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf1
   */
  failureReason: null
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf1
   */
  committedAt: null
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf1
   */
  imageAccess: null
}

/**
 * @export
 */
export const SilhouetteProfileResponseDataMyFormOneOf1StatusEnum = {
  bytes_uploaded: 'bytes_uploaded',
} as const
export type SilhouetteProfileResponseDataMyFormOneOf1StatusEnum =
  (typeof SilhouetteProfileResponseDataMyFormOneOf1StatusEnum)[keyof typeof SilhouetteProfileResponseDataMyFormOneOf1StatusEnum]

/**
 *
 * @export
 * @interface SilhouetteProfileResponseDataMyFormOneOf2
 */
export interface SilhouetteProfileResponseDataMyFormOneOf2 {
  /**
   *
   * @type {SilhouetteProfileResponseDataMyFormOneOf2StatusEnum}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf2
   */
  status: SilhouetteProfileResponseDataMyFormOneOf2StatusEnum
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf2
   */
  failureReason: null
  /**
   *
   * @type {string}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf2
   */
  committedAt: string
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf2
   */
  imageAccess: null
}

/**
 * @export
 */
export const SilhouetteProfileResponseDataMyFormOneOf2StatusEnum = {
  processing: 'processing',
} as const
export type SilhouetteProfileResponseDataMyFormOneOf2StatusEnum =
  (typeof SilhouetteProfileResponseDataMyFormOneOf2StatusEnum)[keyof typeof SilhouetteProfileResponseDataMyFormOneOf2StatusEnum]

/**
 *
 * @export
 * @interface SilhouetteProfileResponseDataMyFormOneOf3
 */
export interface SilhouetteProfileResponseDataMyFormOneOf3 {
  /**
   *
   * @type {SilhouetteProfileResponseDataMyFormOneOf3StatusEnum}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf3
   */
  status: SilhouetteProfileResponseDataMyFormOneOf3StatusEnum
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf3
   */
  failureReason: null
  /**
   *
   * @type {string}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf3
   */
  committedAt: string
  /**
   *
   * @type {CreateGarmentItemResponseDataImageAccess}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf3
   */
  imageAccess: CreateGarmentItemResponseDataImageAccess
}

/**
 * @export
 */
export const SilhouetteProfileResponseDataMyFormOneOf3StatusEnum = {
  ready: 'ready',
} as const
export type SilhouetteProfileResponseDataMyFormOneOf3StatusEnum =
  (typeof SilhouetteProfileResponseDataMyFormOneOf3StatusEnum)[keyof typeof SilhouetteProfileResponseDataMyFormOneOf3StatusEnum]

/**
 *
 * @export
 * @interface SilhouetteProfileResponseDataMyFormOneOf4
 */
export interface SilhouetteProfileResponseDataMyFormOneOf4 {
  /**
   *
   * @type {SilhouetteProfileResponseDataMyFormOneOf4StatusEnum}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf4
   */
  status: SilhouetteProfileResponseDataMyFormOneOf4StatusEnum
  /**
   *
   * @type {SilhouetteProfileResponseDataMyFormOneOf4FailureReasonEnum}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf4
   */
  failureReason: SilhouetteProfileResponseDataMyFormOneOf4FailureReasonEnum
  /**
   *
   * @type {string}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf4
   */
  committedAt: string
  /**
   *
   * @type {null}
   * @memberof SilhouetteProfileResponseDataMyFormOneOf4
   */
  imageAccess: null
}

/**
 * @export
 */
export const SilhouetteProfileResponseDataMyFormOneOf4StatusEnum = {
  failed: 'failed',
} as const
export type SilhouetteProfileResponseDataMyFormOneOf4StatusEnum =
  (typeof SilhouetteProfileResponseDataMyFormOneOf4StatusEnum)[keyof typeof SilhouetteProfileResponseDataMyFormOneOf4StatusEnum]

/**
 * @export
 */
export const SilhouetteProfileResponseDataMyFormOneOf4FailureReasonEnum = {
  contrast: 'contrast',
  privacy_violation: 'privacy_violation',
  timeout: 'timeout',
  storage_error: 'storage_error',
} as const
export type SilhouetteProfileResponseDataMyFormOneOf4FailureReasonEnum =
  (typeof SilhouetteProfileResponseDataMyFormOneOf4FailureReasonEnum)[keyof typeof SilhouetteProfileResponseDataMyFormOneOf4FailureReasonEnum]

/**
 *
 * @export
 */
export const SkinDepth = {
  fair: 'fair',
  light: 'light',
  medium: 'medium',
  tan: 'tan',
  deep: 'deep',
} as const
export type SkinDepth = (typeof SkinDepth)[keyof typeof SkinDepth]

/**
 *
 * @export
 */
export const SkinUndertone = {
  warm: 'warm',
  cool: 'cool',
  neutral: 'neutral',
  olive: 'olive',
} as const
export type SkinUndertone = (typeof SkinUndertone)[keyof typeof SkinUndertone]

/**
 * @type Subscription
 * One variant per subscription presence. The correlations between status and the entitlement fields are expressed by the variants themselves: a `none` response carries null entitlement fields with the keys still serialized, and an entitled response always carries all of them.
 * @export
 */
export type Subscription = SubscriptionOneOf | SubscriptionOneOf1
/**
 *
 * @export
 * @interface SubscriptionOneOf
 */
export interface SubscriptionOneOf {
  /**
   *
   * @type {SubscriptionOneOfStatusEnum}
   * @memberof SubscriptionOneOf
   */
  status: SubscriptionOneOfStatusEnum
  /**
   *
   * @type {null}
   * @memberof SubscriptionOneOf
   */
  store: null
  /**
   *
   * @type {null}
   * @memberof SubscriptionOneOf
   */
  productId: null
  /**
   *
   * @type {null}
   * @memberof SubscriptionOneOf
   */
  willRenew: null
  /**
   *
   * @type {null}
   * @memberof SubscriptionOneOf
   */
  currentPeriodEnd: null
  /**
   *
   * @type {null}
   * @memberof SubscriptionOneOf
   */
  syncedAt: null
  /**
   * Server-evaluated commerce_subscription_enabled flag. The only flag exposure path: clients render subscribe controls only when true. Status, refresh, and portal stay available regardless.
   * @type {boolean}
   * @memberof SubscriptionOneOf
   */
  purchasesEnabled: boolean
}

/**
 * @export
 */
export const SubscriptionOneOfStatusEnum = {
  none: 'none',
} as const
export type SubscriptionOneOfStatusEnum =
  (typeof SubscriptionOneOfStatusEnum)[keyof typeof SubscriptionOneOfStatusEnum]

/**
 *
 * @export
 * @interface SubscriptionOneOf1
 */
export interface SubscriptionOneOf1 {
  /**
   *
   * @type {SubscriptionOneOf1StatusEnum}
   * @memberof SubscriptionOneOf1
   */
  status: SubscriptionOneOf1StatusEnum
  /**
   *
   * @type {SubscriptionOneOf1StoreEnum}
   * @memberof SubscriptionOneOf1
   */
  store: SubscriptionOneOf1StoreEnum
  /**
   * The provisioned product id, e.g. premium_monthly. Deliberately not the plan enum: the operator can add products without a contract change.
   * @type {string}
   * @memberof SubscriptionOneOf1
   */
  productId: string
  /**
   * False after a cancellation while status stays active: the user keeps what they paid for until currentPeriodEnd.
   * @type {boolean}
   * @memberof SubscriptionOneOf1
   */
  willRenew: boolean
  /**
   *
   * @type {string}
   * @memberof SubscriptionOneOf1
   */
  currentPeriodEnd: string
  /**
   * Last successful sync from the entitlement ledger. Lets a client tell fresh state from a rate-limited refresh that served local state.
   * @type {string}
   * @memberof SubscriptionOneOf1
   */
  syncedAt: string
  /**
   * Server-evaluated commerce_subscription_enabled flag. The only flag exposure path: clients render subscribe controls only when true. Status, refresh, and portal stay available regardless.
   * @type {boolean}
   * @memberof SubscriptionOneOf1
   */
  purchasesEnabled: boolean
}

/**
 * @export
 */
export const SubscriptionOneOf1StatusEnum = {
  active: 'active',
  grace_period: 'grace_period',
  expired: 'expired',
  revoked: 'revoked',
} as const
export type SubscriptionOneOf1StatusEnum =
  (typeof SubscriptionOneOf1StatusEnum)[keyof typeof SubscriptionOneOf1StatusEnum]

/**
 * @export
 */
export const SubscriptionOneOf1StoreEnum = {
  app_store: 'app_store',
  play_store: 'play_store',
  stripe: 'stripe',
  promotional: 'promotional',
} as const
export type SubscriptionOneOf1StoreEnum =
  (typeof SubscriptionOneOf1StoreEnum)[keyof typeof SubscriptionOneOf1StoreEnum]

/**
 *
 * @export
 */
export const SubscriptionPlan = {
  premium_monthly: 'premium_monthly',
  premium_annual: 'premium_annual',
} as const
export type SubscriptionPlan = (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan]

/**
 *
 * @export
 * @interface SubscriptionResponse
 */
export interface SubscriptionResponse {
  /**
   *
   * @type {SubscriptionResponseData}
   * @memberof SubscriptionResponse
   */
  data: SubscriptionResponseData
}
/**
 * @type SubscriptionResponseData
 * One variant per subscription presence. The correlations between status and the entitlement fields are expressed by the variants themselves: a `none` response carries null entitlement fields with the keys still serialized, and an entitled response always carries all of them.
 * @export
 */
export type SubscriptionResponseData = SubscriptionOneOf | SubscriptionOneOf1

/**
 *
 * @export
 */
export const SubscriptionStatus = {
  none: 'none',
  active: 'active',
  grace_period: 'grace_period',
  expired: 'expired',
  revoked: 'revoked',
} as const
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]

/**
 *
 * @export
 * @interface SuggestGarmentTagsResponse
 */
export interface SuggestGarmentTagsResponse {
  /**
   *
   * @type {SuggestGarmentTagsResponseData}
   * @memberof SuggestGarmentTagsResponse
   */
  data: SuggestGarmentTagsResponseData
}
/**
 *
 * @export
 * @interface SuggestGarmentTagsResponseData
 */
export interface SuggestGarmentTagsResponseData {
  /**
   *
   * @type {string}
   * @memberof SuggestGarmentTagsResponseData
   */
  garmentId: string
  /**
   *
   * @type {SuggestGarmentTagsResponseDataAnalysisVersionEnum}
   * @memberof SuggestGarmentTagsResponseData
   */
  analysisVersion: SuggestGarmentTagsResponseDataAnalysisVersionEnum
  /**
   *
   * @type {SuggestGarmentTagsResponseDataSuggestions}
   * @memberof SuggestGarmentTagsResponseData
   */
  suggestions: SuggestGarmentTagsResponseDataSuggestions
}

/**
 * @export
 */
export const SuggestGarmentTagsResponseDataAnalysisVersionEnum = {
  fashion_clip_7e3ba62ce16b379a1ab479346b66f192e76f51b7_prompts_v1:
    'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1',
} as const
export type SuggestGarmentTagsResponseDataAnalysisVersionEnum =
  (typeof SuggestGarmentTagsResponseDataAnalysisVersionEnum)[keyof typeof SuggestGarmentTagsResponseDataAnalysisVersionEnum]

/**
 *
 * @export
 * @interface SuggestGarmentTagsResponseDataSuggestions
 */
export interface SuggestGarmentTagsResponseDataSuggestions {
  /**
   *
   * @type {SuggestGarmentTagsResponseDataSuggestionsCategory}
   * @memberof SuggestGarmentTagsResponseDataSuggestions
   */
  category: SuggestGarmentTagsResponseDataSuggestionsCategory
  /**
   *
   * @type {SuggestGarmentTagsResponseDataSuggestionsMaterial}
   * @memberof SuggestGarmentTagsResponseDataSuggestions
   */
  material: SuggestGarmentTagsResponseDataSuggestionsMaterial
  /**
   *
   * @type {SuggestGarmentTagsResponseDataSuggestionsComfortRange}
   * @memberof SuggestGarmentTagsResponseDataSuggestions
   */
  comfortRange: SuggestGarmentTagsResponseDataSuggestionsComfortRange
}
/**
 *
 * @export
 * @interface SuggestGarmentTagsResponseDataSuggestionsCategory
 */
export interface SuggestGarmentTagsResponseDataSuggestionsCategory {
  /**
   *
   * @type {SuggestGarmentTagsResponseDataSuggestionsCategoryValueEnum}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsCategory
   */
  value: SuggestGarmentTagsResponseDataSuggestionsCategoryValueEnum | null
  /**
   *
   * @type {number}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsCategory
   */
  confidence: number
  /**
   *
   * @type {boolean}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsCategory
   */
  isConfident: boolean
}

/**
 * @export
 */
export const SuggestGarmentTagsResponseDataSuggestionsCategoryValueEnum = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  dress: 'dress',
  shoes: 'shoes',
  accessory: 'accessory',
} as const
export type SuggestGarmentTagsResponseDataSuggestionsCategoryValueEnum =
  (typeof SuggestGarmentTagsResponseDataSuggestionsCategoryValueEnum)[keyof typeof SuggestGarmentTagsResponseDataSuggestionsCategoryValueEnum]

/**
 *
 * @export
 * @interface SuggestGarmentTagsResponseDataSuggestionsComfortRange
 */
export interface SuggestGarmentTagsResponseDataSuggestionsComfortRange {
  /**
   *
   * @type {SuggestGarmentTagsResponseDataSuggestionsComfortRangeValueEnum}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsComfortRange
   */
  value: SuggestGarmentTagsResponseDataSuggestionsComfortRangeValueEnum | null
  /**
   *
   * @type {number}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsComfortRange
   */
  confidence: number
  /**
   *
   * @type {boolean}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsComfortRange
   */
  isConfident: boolean
}

/**
 * @export
 */
export const SuggestGarmentTagsResponseDataSuggestionsComfortRangeValueEnum = {
  cold: 'cold',
  cool: 'cool',
  mild: 'mild',
  warm: 'warm',
  hot: 'hot',
} as const
export type SuggestGarmentTagsResponseDataSuggestionsComfortRangeValueEnum =
  (typeof SuggestGarmentTagsResponseDataSuggestionsComfortRangeValueEnum)[keyof typeof SuggestGarmentTagsResponseDataSuggestionsComfortRangeValueEnum]

/**
 *
 * @export
 * @interface SuggestGarmentTagsResponseDataSuggestionsMaterial
 */
export interface SuggestGarmentTagsResponseDataSuggestionsMaterial {
  /**
   *
   * @type {SuggestGarmentTagsResponseDataSuggestionsMaterialValueEnum}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsMaterial
   */
  value: SuggestGarmentTagsResponseDataSuggestionsMaterialValueEnum | null
  /**
   *
   * @type {number}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsMaterial
   */
  confidence: number
  /**
   *
   * @type {boolean}
   * @memberof SuggestGarmentTagsResponseDataSuggestionsMaterial
   */
  isConfident: boolean
}

/**
 * @export
 */
export const SuggestGarmentTagsResponseDataSuggestionsMaterialValueEnum = {
  cotton: 'cotton',
  wool: 'wool',
  linen: 'linen',
  leather: 'leather',
  denim: 'denim',
  fleece: 'fleece',
  synthetic: 'synthetic',
  down: 'down',
  silk: 'silk',
} as const
export type SuggestGarmentTagsResponseDataSuggestionsMaterialValueEnum =
  (typeof SuggestGarmentTagsResponseDataSuggestionsMaterialValueEnum)[keyof typeof SuggestGarmentTagsResponseDataSuggestionsMaterialValueEnum]

/**
 *
 * @export
 * @interface TrackedResponse
 */
export interface TrackedResponse {
  /**
   *
   * @type {TrackedResponseTrackedEnum}
   * @memberof TrackedResponse
   */
  tracked: TrackedResponseTrackedEnum
}

/**
 * @export
 */
export const TrackedResponseTrackedEnum = {
  true: true,
} as const
export type TrackedResponseTrackedEnum =
  (typeof TrackedResponseTrackedEnum)[keyof typeof TrackedResponseTrackedEnum]

/**
 *
 * @export
 * @interface UnauthorizedHttpError
 */
export interface UnauthorizedHttpError {
  /**
   *
   * @type {UnauthorizedHttpErrorStatusCodeEnum}
   * @memberof UnauthorizedHttpError
   */
  statusCode: UnauthorizedHttpErrorStatusCodeEnum
  /**
   *
   * @type {string}
   * @memberof UnauthorizedHttpError
   */
  message: string
  /**
   *
   * @type {UnauthorizedHttpErrorErrorEnum}
   * @memberof UnauthorizedHttpError
   */
  error: UnauthorizedHttpErrorErrorEnum
}

/**
 * @export
 */
export const UnauthorizedHttpErrorStatusCodeEnum = {
  NUMBER_401: 401,
} as const
export type UnauthorizedHttpErrorStatusCodeEnum =
  (typeof UnauthorizedHttpErrorStatusCodeEnum)[keyof typeof UnauthorizedHttpErrorStatusCodeEnum]

/**
 * @export
 */
export const UnauthorizedHttpErrorErrorEnum = {
  Unauthorized: 'Unauthorized',
} as const
export type UnauthorizedHttpErrorErrorEnum =
  (typeof UnauthorizedHttpErrorErrorEnum)[keyof typeof UnauthorizedHttpErrorErrorEnum]

/**
 *
 * @export
 * @interface UpdateAdvisorRecommendationInput
 */
export interface UpdateAdvisorRecommendationInput {
  /**
   *
   * @type {string}
   * @memberof UpdateAdvisorRecommendationInput
   */
  itemKey: string
  /**
   *
   * @type {UpdateAdvisorRecommendationInputSlotEnum}
   * @memberof UpdateAdvisorRecommendationInput
   */
  slot: UpdateAdvisorRecommendationInputSlotEnum
  /**
   *
   * @type {UpdateAdvisorRecommendationInputActionEnum}
   * @memberof UpdateAdvisorRecommendationInput
   */
  action: UpdateAdvisorRecommendationInputActionEnum | null
}

/**
 * @export
 */
export const UpdateAdvisorRecommendationInputSlotEnum = {
  foundation: 'foundation',
  blush: 'blush',
  jewelry: 'jewelry',
  bag: 'bag',
  eyewear: 'eyewear',
} as const
export type UpdateAdvisorRecommendationInputSlotEnum =
  (typeof UpdateAdvisorRecommendationInputSlotEnum)[keyof typeof UpdateAdvisorRecommendationInputSlotEnum]

/**
 * @export
 */
export const UpdateAdvisorRecommendationInputActionEnum = {
  saved: 'saved',
  dismissed: 'dismissed',
} as const
export type UpdateAdvisorRecommendationInputActionEnum =
  (typeof UpdateAdvisorRecommendationInputActionEnum)[keyof typeof UpdateAdvisorRecommendationInputActionEnum]

/**
 *
 * @export
 * @interface UpdateAdvisorRecommendationResponse
 */
export interface UpdateAdvisorRecommendationResponse {
  /**
   *
   * @type {PaletteAdvisorProfileResponseData}
   * @memberof UpdateAdvisorRecommendationResponse
   */
  data: PaletteAdvisorProfileResponseData
}
/**
 * Collection invariant enforced at runtime and NOT expressible in this schema: ruleType must be unique across rules. JSON Schema uniqueItems compares whole items, so two rules sharing a ruleType but differing elsewhere would pass it while being rejected here.
 * @export
 * @interface UpdateAlertRulesInput
 */
export interface UpdateAlertRulesInput {
  /**
   *
   * @type {Array<UpdateAlertRulesInputRulesInner>}
   * @memberof UpdateAlertRulesInput
   */
  rules: Array<UpdateAlertRulesInputRulesInner>
}
/**
 * @type UpdateAlertRulesInputRulesInner
 *
 * @export
 */
export type UpdateAlertRulesInputRulesInner =
  | AlertRuleOneOf
  | AlertRuleOneOf1
  | AlertRuleOneOf2
/**
 *
 * @export
 * @interface UpdateAlertRulesResponse
 */
export interface UpdateAlertRulesResponse {
  /**
   *
   * @type {UpdateAlertRulesResponseData}
   * @memberof UpdateAlertRulesResponse
   */
  data: UpdateAlertRulesResponseData
}
/**
 *
 * @export
 * @interface UpdateAlertRulesResponseData
 */
export interface UpdateAlertRulesResponseData {
  /**
   *
   * @type {Array<UpdateAlertRulesInputRulesInner>}
   * @memberof UpdateAlertRulesResponseData
   */
  rules: Array<UpdateAlertRulesInputRulesInner>
}
/**
 *
 * @export
 * @interface UpdateComfortPreferencesInput
 */
export interface UpdateComfortPreferencesInput {
  /**
   *
   * @type {UpdateComfortPreferencesInputRunsColdWarmEnum}
   * @memberof UpdateComfortPreferencesInput
   */
  runsColdWarm: UpdateComfortPreferencesInputRunsColdWarmEnum
  /**
   *
   * @type {UpdateComfortPreferencesInputWindToleranceEnum}
   * @memberof UpdateComfortPreferencesInput
   */
  windTolerance: UpdateComfortPreferencesInputWindToleranceEnum
  /**
   *
   * @type {UpdateComfortPreferencesInputPrecipPreparednessEnum}
   * @memberof UpdateComfortPreferencesInput
   */
  precipPreparedness: UpdateComfortPreferencesInputPrecipPreparednessEnum
}

/**
 * @export
 */
export const UpdateComfortPreferencesInputRunsColdWarmEnum = {
  cold: 'cold',
  neutral: 'neutral',
  warm: 'warm',
} as const
export type UpdateComfortPreferencesInputRunsColdWarmEnum =
  (typeof UpdateComfortPreferencesInputRunsColdWarmEnum)[keyof typeof UpdateComfortPreferencesInputRunsColdWarmEnum]

/**
 * @export
 */
export const UpdateComfortPreferencesInputWindToleranceEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type UpdateComfortPreferencesInputWindToleranceEnum =
  (typeof UpdateComfortPreferencesInputWindToleranceEnum)[keyof typeof UpdateComfortPreferencesInputWindToleranceEnum]

/**
 * @export
 */
export const UpdateComfortPreferencesInputPrecipPreparednessEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type UpdateComfortPreferencesInputPrecipPreparednessEnum =
  (typeof UpdateComfortPreferencesInputPrecipPreparednessEnum)[keyof typeof UpdateComfortPreferencesInputPrecipPreparednessEnum]

/**
 *
 * @export
 * @interface UpdateComfortPreferencesResponse
 */
export interface UpdateComfortPreferencesResponse {
  /**
   *
   * @type {ComfortPreferencesResponseData}
   * @memberof UpdateComfortPreferencesResponse
   */
  data: ComfortPreferencesResponseData
}
/**
 *
 * @export
 * @interface UpdateCommercePreferenceInput
 */
export interface UpdateCommercePreferenceInput {
  /**
   * False hides every affiliate CTA. Defaults true; a user with no stored row reads as true.
   * @type {boolean}
   * @memberof UpdateCommercePreferenceInput
   */
  affiliateCtasEnabled: boolean
}
/**
 *
 * @export
 * @interface UpdateCommercePreferenceResponse
 */
export interface UpdateCommercePreferenceResponse {
  /**
   *
   * @type {CommercePreferenceResponseData}
   * @memberof UpdateCommercePreferenceResponse
   */
  data: CommercePreferenceResponseData
}
/**
 *
 * @export
 * @interface UpdateGarmentTagsInput
 */
export interface UpdateGarmentTagsInput {
  /**
   *
   * @type {UpdateGarmentTagsInputCategoryEnum}
   * @memberof UpdateGarmentTagsInput
   */
  category: UpdateGarmentTagsInputCategoryEnum | null
  /**
   *
   * @type {UpdateGarmentTagsInputMaterialEnum}
   * @memberof UpdateGarmentTagsInput
   */
  material?: UpdateGarmentTagsInputMaterialEnum | null
  /**
   *
   * @type {UpdateGarmentTagsInputComfortRangeEnum}
   * @memberof UpdateGarmentTagsInput
   */
  comfortRange: UpdateGarmentTagsInputComfortRangeEnum | null
}

/**
 * @export
 */
export const UpdateGarmentTagsInputCategoryEnum = {
  top: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  dress: 'dress',
  shoes: 'shoes',
  accessory: 'accessory',
} as const
export type UpdateGarmentTagsInputCategoryEnum =
  (typeof UpdateGarmentTagsInputCategoryEnum)[keyof typeof UpdateGarmentTagsInputCategoryEnum]

/**
 * @export
 */
export const UpdateGarmentTagsInputMaterialEnum = {
  cotton: 'cotton',
  wool: 'wool',
  linen: 'linen',
  leather: 'leather',
  denim: 'denim',
  fleece: 'fleece',
  synthetic: 'synthetic',
  down: 'down',
  silk: 'silk',
} as const
export type UpdateGarmentTagsInputMaterialEnum =
  (typeof UpdateGarmentTagsInputMaterialEnum)[keyof typeof UpdateGarmentTagsInputMaterialEnum]

/**
 * @export
 */
export const UpdateGarmentTagsInputComfortRangeEnum = {
  cold: 'cold',
  cool: 'cool',
  mild: 'mild',
  warm: 'warm',
  hot: 'hot',
} as const
export type UpdateGarmentTagsInputComfortRangeEnum =
  (typeof UpdateGarmentTagsInputComfortRangeEnum)[keyof typeof UpdateGarmentTagsInputComfortRangeEnum]

/**
 *
 * @export
 * @interface UpdateGarmentTagsResponse
 */
export interface UpdateGarmentTagsResponse {
  /**
   *
   * @type {CreateGarmentItemResponseData}
   * @memberof UpdateGarmentTagsResponse
   */
  data: CreateGarmentItemResponseData
}
/**
 * Cross-field invariant enforced at runtime and NOT expressible in this schema: when quietHoursEnabled is true, quietHoursStart and quietHoursEnd must differ. JSON Schema has no operator comparing two sibling properties, so this rule is only visible here and in the 400 returned when it is violated.
 * @export
 * @interface UpdateNotificationPreferencesInput
 */
export interface UpdateNotificationPreferencesInput {
  /**
   *
   * @type {boolean}
   * @memberof UpdateNotificationPreferencesInput
   */
  quietHoursEnabled: boolean
  /**
   *
   * @type {boolean}
   * @memberof UpdateNotificationPreferencesInput
   */
  pushEnabled: boolean
  /**
   *
   * @type {string}
   * @memberof UpdateNotificationPreferencesInput
   */
  quietHoursStart: string
  /**
   *
   * @type {string}
   * @memberof UpdateNotificationPreferencesInput
   */
  quietHoursEnd: string
  /**
   * Invariant enforced at runtime and NOT expressible in this schema: the value must be a valid IANA timezone name as resolved by the host Intl database (for example America/New_York). Any other bounded string is rejected.
   * @type {string}
   * @memberof UpdateNotificationPreferencesInput
   */
  timezone: string
}
/**
 *
 * @export
 * @interface UpdateNotificationPreferencesResponse
 */
export interface UpdateNotificationPreferencesResponse {
  /**
   *
   * @type {UpdateNotificationPreferencesResponseData}
   * @memberof UpdateNotificationPreferencesResponse
   */
  data: UpdateNotificationPreferencesResponseData
}
/**
 *
 * @export
 * @interface UpdateNotificationPreferencesResponseData
 */
export interface UpdateNotificationPreferencesResponseData {
  /**
   *
   * @type {GetAlertPreferencesResponseDataPreferences}
   * @memberof UpdateNotificationPreferencesResponseData
   */
  preferences: GetAlertPreferencesResponseDataPreferences
}
/**
 *
 * @export
 * @interface UpdateOutfitCapsuleInput
 */
export interface UpdateOutfitCapsuleInput {
  /**
   * Trimmed and NFC-normalized before validation, then bounded to 1-60 extended grapheme clusters (user-perceived characters), not UTF-16 code units. A JSON Schema maxLength cannot express this: an emoji with a skin-tone modifier counts as one here and as four code units there. null bytes are rejected because PostgreSQL text cannot store them.
   * @type {string}
   * @memberof UpdateOutfitCapsuleInput
   */
  name?: string
  /**
   * Trimmed and NFC-normalized before validation, then bounded to 0-280 extended grapheme clusters (user-perceived characters), not UTF-16 code units. A JSON Schema maxLength cannot express this: an emoji with a skin-tone modifier counts as one here and as four code units there. null bytes are rejected because PostgreSQL text cannot store them.
   * @type {string}
   * @memberof UpdateOutfitCapsuleInput
   */
  description?: string | null
  /**
   *
   * @type {Array<UpdateOutfitCapsuleInputOccasionsEnum>}
   * @memberof UpdateOutfitCapsuleInput
   */
  occasions?: Array<UpdateOutfitCapsuleInputOccasionsEnum>
  /**
   * Collection invariant enforced at runtime and NOT expressible in this schema: garmentIds must contain no duplicates. JSON Schema uniqueItems would express this for a plain string array, but it is not emitted here, so the rule is only visible in this description and in the 400 returned when it is violated.
   * @type {Array<string>}
   * @memberof UpdateOutfitCapsuleInput
   */
  garmentIds?: Array<string>
  /**
   *
   * @type {boolean}
   * @memberof UpdateOutfitCapsuleInput
   */
  isFavorite?: boolean
}

/**
 * @export
 */
export const UpdateOutfitCapsuleInputOccasionsEnum = {
  work: 'work',
  casual: 'casual',
  formal: 'formal',
  sport: 'sport',
  travel: 'travel',
  evening: 'evening',
  outdoor: 'outdoor',
  home: 'home',
} as const
export type UpdateOutfitCapsuleInputOccasionsEnum =
  (typeof UpdateOutfitCapsuleInputOccasionsEnum)[keyof typeof UpdateOutfitCapsuleInputOccasionsEnum]

/**
 *
 * @export
 * @interface UpdatePremiumThemeInput
 */
export interface UpdatePremiumThemeInput {
  /**
   * The palette to store. null resets to Default; it upserts the stored row to null and never deletes it, so reset and downgrade stay distinguishable from "never chose".
   * @type {UpdatePremiumThemeInputThemeEnum}
   * @memberof UpdatePremiumThemeInput
   */
  theme: UpdatePremiumThemeInputThemeEnum | null
}

/**
 * @export
 */
export const UpdatePremiumThemeInputThemeEnum = {
  jewel_radiance: 'jewel_radiance',
  autumn_umber: 'autumn_umber',
  winter_metallic: 'winter_metallic',
} as const
export type UpdatePremiumThemeInputThemeEnum =
  (typeof UpdatePremiumThemeInputThemeEnum)[keyof typeof UpdatePremiumThemeInputThemeEnum]

/**
 *
 * @export
 * @interface UpdatePremiumThemeResponse
 */
export interface UpdatePremiumThemeResponse {
  /**
   *
   * @type {PremiumThemeResponseData}
   * @memberof UpdatePremiumThemeResponse
   */
  data: PremiumThemeResponseData
}
/**
 * Cross-field invariants enforced at runtime and NOT expressible in this schema: (1) at least one property must be present, so an empty patch body is rejected rather than treated as a no-op; (2) locationKey, latitude, longitude, and timezone form one identity group and must be sent all together or not at all, because updating a coordinate without its key would leave the row internally inconsistent.
 * @export
 * @interface UpdateSavedLocationInput
 */
export interface UpdateSavedLocationInput {
  /**
   *
   * @type {string}
   * @memberof UpdateSavedLocationInput
   */
  label?: string
  /**
   *
   * @type {string}
   * @memberof UpdateSavedLocationInput
   */
  locationKey?: string
  /**
   *
   * @type {number}
   * @memberof UpdateSavedLocationInput
   */
  latitude?: number
  /**
   *
   * @type {number}
   * @memberof UpdateSavedLocationInput
   */
  longitude?: number
  /**
   *
   * @type {string}
   * @memberof UpdateSavedLocationInput
   */
  timezone?: string
  /**
   *
   * @type {string}
   * @memberof UpdateSavedLocationInput
   */
  city?: string | null
  /**
   *
   * @type {string}
   * @memberof UpdateSavedLocationInput
   */
  region?: string | null
  /**
   *
   * @type {string}
   * @memberof UpdateSavedLocationInput
   */
  country?: string | null
  /**
   *
   * @type {number}
   * @memberof UpdateSavedLocationInput
   */
  sortOrder?: number
}
/**
 *
 * @export
 * @interface UpdateSavedLocationResponse
 */
export interface UpdateSavedLocationResponse {
  /**
   *
   * @type {ListSavedLocationsResponseDataInner}
   * @memberof UpdateSavedLocationResponse
   */
  data: ListSavedLocationsResponseDataInner
}
/**
 *
 * @export
 * @interface UpdateSilhouetteSlidersInput
 */
export interface UpdateSilhouetteSlidersInput {
  /**
   *
   * @type {number}
   * @memberof UpdateSilhouetteSlidersInput
   */
  heightSlider: number
  /**
   *
   * @type {number}
   * @memberof UpdateSilhouetteSlidersInput
   */
  buildSlider: number
}
/**
 *
 * @export
 * @interface UpdateWardrobeOnboardingStateInput
 */
export interface UpdateWardrobeOnboardingStateInput {
  /**
   *
   * @type {UpdateWardrobeOnboardingStateInputTargetStepEnum}
   * @memberof UpdateWardrobeOnboardingStateInput
   */
  targetStep: UpdateWardrobeOnboardingStateInputTargetStepEnum
  /**
   *
   * @type {boolean}
   * @memberof UpdateWardrobeOnboardingStateInput
   */
  usedStarterWardrobe?: boolean
}

/**
 * @export
 */
export const UpdateWardrobeOnboardingStateInputTargetStepEnum = {
  permission: 'permission',
  capture: 'capture',
  tagging: 'tagging',
  silhouette: 'silhouette',
  complete: 'complete',
} as const
export type UpdateWardrobeOnboardingStateInputTargetStepEnum =
  (typeof UpdateWardrobeOnboardingStateInputTargetStepEnum)[keyof typeof UpdateWardrobeOnboardingStateInputTargetStepEnum]

/**
 *
 * @export
 * @interface UserPreferencesInput
 */
export interface UserPreferencesInput {
  /**
   *
   * @type {UserPreferencesInputLocaleEnum}
   * @memberof UserPreferencesInput
   */
  locale: UserPreferencesInputLocaleEnum
}

/**
 * @export
 */
export const UserPreferencesInputLocaleEnum = {
  en_US: 'en-US',
  en_CA: 'en-CA',
  es_419: 'es-419',
  fr_CA: 'fr-CA',
  fr_FR: 'fr-FR',
  tr_TR: 'tr-TR',
  de_DE: 'de-DE',
  it_IT: 'it-IT',
  pt_BR: 'pt-BR',
  pt_PT: 'pt-PT',
} as const
export type UserPreferencesInputLocaleEnum =
  (typeof UserPreferencesInputLocaleEnum)[keyof typeof UserPreferencesInputLocaleEnum]

/**
 *
 * @export
 * @interface UserPreferencesResponse
 */
export interface UserPreferencesResponse {
  /**
   *
   * @type {UserPreferencesResponseSuccessEnum}
   * @memberof UserPreferencesResponse
   */
  success: UserPreferencesResponseSuccessEnum
}

/**
 * @export
 */
export const UserPreferencesResponseSuccessEnum = {
  true: true,
} as const
export type UserPreferencesResponseSuccessEnum =
  (typeof UserPreferencesResponseSuccessEnum)[keyof typeof UserPreferencesResponseSuccessEnum]

/**
 *
 * @export
 * @interface UserProfileResponse
 */
export interface UserProfileResponse {
  /**
   *
   * @type {UserProfileResponseUser}
   * @memberof UserProfileResponse
   */
  user: UserProfileResponseUser
  /**
   *
   * @type {Array<UserProfileResponseLinkedGuardiansInner>}
   * @memberof UserProfileResponse
   */
  linkedGuardians: Array<UserProfileResponseLinkedGuardiansInner>
  /**
   *
   * @type {Array<UserProfileResponseLinkedTeensInner>}
   * @memberof UserProfileResponse
   */
  linkedTeens: Array<UserProfileResponseLinkedTeensInner>
}
/**
 *
 * @export
 * @interface UserProfileResponseLinkedGuardiansInner
 */
export interface UserProfileResponseLinkedGuardiansInner {
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseLinkedGuardiansInner
   */
  guardianId: string
  /**
   *
   * @type {UserProfileResponseLinkedGuardiansInnerStatusEnum}
   * @memberof UserProfileResponseLinkedGuardiansInner
   */
  status: UserProfileResponseLinkedGuardiansInnerStatusEnum
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseLinkedGuardiansInner
   */
  consentGrantedAt: string | null
}

/**
 * @export
 */
export const UserProfileResponseLinkedGuardiansInnerStatusEnum = {
  pending: 'pending',
  granted: 'granted',
  revoked: 'revoked',
} as const
export type UserProfileResponseLinkedGuardiansInnerStatusEnum =
  (typeof UserProfileResponseLinkedGuardiansInnerStatusEnum)[keyof typeof UserProfileResponseLinkedGuardiansInnerStatusEnum]

/**
 *
 * @export
 * @interface UserProfileResponseLinkedTeensInner
 */
export interface UserProfileResponseLinkedTeensInner {
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseLinkedTeensInner
   */
  teenId: string
  /**
   *
   * @type {UserProfileResponseLinkedTeensInnerStatusEnum}
   * @memberof UserProfileResponseLinkedTeensInner
   */
  status: UserProfileResponseLinkedTeensInnerStatusEnum
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseLinkedTeensInner
   */
  consentGrantedAt: string | null
}

/**
 * @export
 */
export const UserProfileResponseLinkedTeensInnerStatusEnum = {
  pending: 'pending',
  granted: 'granted',
  revoked: 'revoked',
} as const
export type UserProfileResponseLinkedTeensInnerStatusEnum =
  (typeof UserProfileResponseLinkedTeensInnerStatusEnum)[keyof typeof UserProfileResponseLinkedTeensInnerStatusEnum]

/**
 *
 * @export
 * @interface UserProfileResponseUser
 */
export interface UserProfileResponseUser {
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseUser
   */
  id: string
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseUser
   */
  email: string
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseUser
   */
  displayName: string | null
  /**
   *
   * @type {string}
   * @memberof UserProfileResponseUser
   */
  birthdate: string | null
  /**
   *
   * @type {UserProfileResponseUserRoleEnum}
   * @memberof UserProfileResponseUser
   */
  role: UserProfileResponseUserRoleEnum
}

/**
 * @export
 */
export const UserProfileResponseUserRoleEnum = {
  guardian: 'guardian',
  teen: 'teen',
  moderator: 'moderator',
  admin: 'admin',
} as const
export type UserProfileResponseUserRoleEnum =
  (typeof UserProfileResponseUserRoleEnum)[keyof typeof UserProfileResponseUserRoleEnum]

/**
 *
 * @export
 * @interface WardrobeOnboardingStateResponse
 */
export interface WardrobeOnboardingStateResponse {
  /**
   *
   * @type {WardrobeOnboardingStateResponseData}
   * @memberof WardrobeOnboardingStateResponse
   */
  data: WardrobeOnboardingStateResponseData
}
/**
 * @type WardrobeOnboardingStateResponseData
 * One variant per lifecycle status. The correlations between status, currentStep, startedAt, completedAt and revision are expressed by the variants themselves rather than enforced by an invisible runtime check, so an invalid combination such as a completed state with a null completedAt is unrepresentable in the generated types.
 * @export
 */
export type WardrobeOnboardingStateResponseData =
  | WardrobeOnboardingStateResponseDataOneOf
  | WardrobeOnboardingStateResponseDataOneOf1
  | WardrobeOnboardingStateResponseDataOneOf2
/**
 *
 * @export
 * @interface WardrobeOnboardingStateResponseDataOneOf
 */
export interface WardrobeOnboardingStateResponseDataOneOf {
  /**
   *
   * @type {WardrobeOnboardingStateResponseDataOneOfStatusEnum}
   * @memberof WardrobeOnboardingStateResponseDataOneOf
   */
  status: WardrobeOnboardingStateResponseDataOneOfStatusEnum
  /**
   *
   * @type {WardrobeOnboardingStateResponseDataOneOfCurrentStepEnum}
   * @memberof WardrobeOnboardingStateResponseDataOneOf
   */
  currentStep: WardrobeOnboardingStateResponseDataOneOfCurrentStepEnum
  /**
   *
   * @type {boolean}
   * @memberof WardrobeOnboardingStateResponseDataOneOf
   */
  usedStarterWardrobe: boolean
  /**
   *
   * @type {number}
   * @memberof WardrobeOnboardingStateResponseDataOneOf
   */
  garmentsCapturedCount: number
  /**
   *
   * @type {null}
   * @memberof WardrobeOnboardingStateResponseDataOneOf
   */
  startedAt: null
  /**
   *
   * @type {null}
   * @memberof WardrobeOnboardingStateResponseDataOneOf
   */
  completedAt: null
  /**
   *
   * @type {WardrobeOnboardingStateResponseDataOneOfRevisionEnum}
   * @memberof WardrobeOnboardingStateResponseDataOneOf
   */
  revision: WardrobeOnboardingStateResponseDataOneOfRevisionEnum
}

/**
 * @export
 */
export const WardrobeOnboardingStateResponseDataOneOfStatusEnum = {
  not_started: 'not_started',
} as const
export type WardrobeOnboardingStateResponseDataOneOfStatusEnum =
  (typeof WardrobeOnboardingStateResponseDataOneOfStatusEnum)[keyof typeof WardrobeOnboardingStateResponseDataOneOfStatusEnum]

/**
 * @export
 */
export const WardrobeOnboardingStateResponseDataOneOfCurrentStepEnum = {
  permission: 'permission',
} as const
export type WardrobeOnboardingStateResponseDataOneOfCurrentStepEnum =
  (typeof WardrobeOnboardingStateResponseDataOneOfCurrentStepEnum)[keyof typeof WardrobeOnboardingStateResponseDataOneOfCurrentStepEnum]

/**
 * @export
 */
export const WardrobeOnboardingStateResponseDataOneOfRevisionEnum = {
  NUMBER_0: 0,
} as const
export type WardrobeOnboardingStateResponseDataOneOfRevisionEnum =
  (typeof WardrobeOnboardingStateResponseDataOneOfRevisionEnum)[keyof typeof WardrobeOnboardingStateResponseDataOneOfRevisionEnum]

/**
 *
 * @export
 * @interface WardrobeOnboardingStateResponseDataOneOf1
 */
export interface WardrobeOnboardingStateResponseDataOneOf1 {
  /**
   *
   * @type {WardrobeOnboardingStateResponseDataOneOf1StatusEnum}
   * @memberof WardrobeOnboardingStateResponseDataOneOf1
   */
  status: WardrobeOnboardingStateResponseDataOneOf1StatusEnum
  /**
   *
   * @type {WardrobeOnboardingStateResponseDataOneOf1CurrentStepEnum}
   * @memberof WardrobeOnboardingStateResponseDataOneOf1
   */
  currentStep: WardrobeOnboardingStateResponseDataOneOf1CurrentStepEnum
  /**
   *
   * @type {boolean}
   * @memberof WardrobeOnboardingStateResponseDataOneOf1
   */
  usedStarterWardrobe: boolean
  /**
   *
   * @type {number}
   * @memberof WardrobeOnboardingStateResponseDataOneOf1
   */
  garmentsCapturedCount: number
  /**
   *
   * @type {string}
   * @memberof WardrobeOnboardingStateResponseDataOneOf1
   */
  startedAt: string
  /**
   *
   * @type {null}
   * @memberof WardrobeOnboardingStateResponseDataOneOf1
   */
  completedAt: null
  /**
   *
   * @type {number}
   * @memberof WardrobeOnboardingStateResponseDataOneOf1
   */
  revision: number
}

/**
 * @export
 */
export const WardrobeOnboardingStateResponseDataOneOf1StatusEnum = {
  in_progress: 'in_progress',
} as const
export type WardrobeOnboardingStateResponseDataOneOf1StatusEnum =
  (typeof WardrobeOnboardingStateResponseDataOneOf1StatusEnum)[keyof typeof WardrobeOnboardingStateResponseDataOneOf1StatusEnum]

/**
 * @export
 */
export const WardrobeOnboardingStateResponseDataOneOf1CurrentStepEnum = {
  permission: 'permission',
  capture: 'capture',
  tagging: 'tagging',
  silhouette: 'silhouette',
} as const
export type WardrobeOnboardingStateResponseDataOneOf1CurrentStepEnum =
  (typeof WardrobeOnboardingStateResponseDataOneOf1CurrentStepEnum)[keyof typeof WardrobeOnboardingStateResponseDataOneOf1CurrentStepEnum]

/**
 *
 * @export
 * @interface WardrobeOnboardingStateResponseDataOneOf2
 */
export interface WardrobeOnboardingStateResponseDataOneOf2 {
  /**
   *
   * @type {WardrobeOnboardingStateResponseDataOneOf2StatusEnum}
   * @memberof WardrobeOnboardingStateResponseDataOneOf2
   */
  status: WardrobeOnboardingStateResponseDataOneOf2StatusEnum
  /**
   *
   * @type {WardrobeOnboardingStateResponseDataOneOf2CurrentStepEnum}
   * @memberof WardrobeOnboardingStateResponseDataOneOf2
   */
  currentStep: WardrobeOnboardingStateResponseDataOneOf2CurrentStepEnum
  /**
   *
   * @type {boolean}
   * @memberof WardrobeOnboardingStateResponseDataOneOf2
   */
  usedStarterWardrobe: boolean
  /**
   *
   * @type {number}
   * @memberof WardrobeOnboardingStateResponseDataOneOf2
   */
  garmentsCapturedCount: number
  /**
   *
   * @type {string}
   * @memberof WardrobeOnboardingStateResponseDataOneOf2
   */
  startedAt: string
  /**
   *
   * @type {string}
   * @memberof WardrobeOnboardingStateResponseDataOneOf2
   */
  completedAt: string
  /**
   *
   * @type {number}
   * @memberof WardrobeOnboardingStateResponseDataOneOf2
   */
  revision: number
}

/**
 * @export
 */
export const WardrobeOnboardingStateResponseDataOneOf2StatusEnum = {
  completed: 'completed',
} as const
export type WardrobeOnboardingStateResponseDataOneOf2StatusEnum =
  (typeof WardrobeOnboardingStateResponseDataOneOf2StatusEnum)[keyof typeof WardrobeOnboardingStateResponseDataOneOf2StatusEnum]

/**
 * @export
 */
export const WardrobeOnboardingStateResponseDataOneOf2CurrentStepEnum = {
  complete: 'complete',
} as const
export type WardrobeOnboardingStateResponseDataOneOf2CurrentStepEnum =
  (typeof WardrobeOnboardingStateResponseDataOneOf2CurrentStepEnum)[keyof typeof WardrobeOnboardingStateResponseDataOneOf2CurrentStepEnum]

/**
 *
 * @export
 * @interface WeatherAlert
 */
export interface WeatherAlert {
  /**
   *
   * @type {string}
   * @memberof WeatherAlert
   */
  event: string
  /**
   *
   * @type {string}
   * @memberof WeatherAlert
   */
  description: string
  /**
   *
   * @type {string}
   * @memberof WeatherAlert
   */
  start: string
  /**
   *
   * @type {string}
   * @memberof WeatherAlert
   */
  end: string
  /**
   *
   * @type {WeatherAlertSeverityEnum}
   * @memberof WeatherAlert
   */
  severity?: WeatherAlertSeverityEnum
}

/**
 * @export
 */
export const WeatherAlertSeverityEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type WeatherAlertSeverityEnum =
  (typeof WeatherAlertSeverityEnum)[keyof typeof WeatherAlertSeverityEnum]

/**
 *
 * @export
 */
export const WeatherCondition = {
  clear: 'clear',
  partly_cloudy: 'partly_cloudy',
  cloudy: 'cloudy',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  sleet: 'sleet',
  snow: 'snow',
  thunderstorm: 'thunderstorm',
  wind: 'wind',
  unknown: 'unknown',
} as const
export type WeatherCondition = (typeof WeatherCondition)[keyof typeof WeatherCondition]

/**
 *
 * @export
 * @interface WeatherCurrent
 */
export interface WeatherCurrent {
  /**
   *
   * @type {number}
   * @memberof WeatherCurrent
   */
  temperature: number
  /**
   *
   * @type {WeatherCurrentConditionEnum}
   * @memberof WeatherCurrent
   */
  condition: WeatherCurrentConditionEnum
}

/**
 * @export
 */
export const WeatherCurrentConditionEnum = {
  clear: 'clear',
  partly_cloudy: 'partly_cloudy',
  cloudy: 'cloudy',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  sleet: 'sleet',
  snow: 'snow',
  thunderstorm: 'thunderstorm',
  wind: 'wind',
  unknown: 'unknown',
} as const
export type WeatherCurrentConditionEnum =
  (typeof WeatherCurrentConditionEnum)[keyof typeof WeatherCurrentConditionEnum]

/**
 *
 * @export
 * @interface WeatherHourlyEntry
 */
export interface WeatherHourlyEntry {
  /**
   *
   * @type {string}
   * @memberof WeatherHourlyEntry
   */
  forecastAt: string
  /**
   *
   * @type {number}
   * @memberof WeatherHourlyEntry
   */
  temperature: number
  /**
   *
   * @type {number}
   * @memberof WeatherHourlyEntry
   */
  feelsLike: number
  /**
   *
   * @type {number}
   * @memberof WeatherHourlyEntry
   */
  precipitationProbability: number
  /**
   *
   * @type {number}
   * @memberof WeatherHourlyEntry
   */
  precipitationAmount: number
  /**
   *
   * @type {number}
   * @memberof WeatherHourlyEntry
   */
  windSpeed: number
  /**
   *
   * @type {number}
   * @memberof WeatherHourlyEntry
   */
  windGust: number | null
  /**
   *
   * @type {WeatherHourlyEntryConditionEnum}
   * @memberof WeatherHourlyEntry
   */
  condition: WeatherHourlyEntryConditionEnum
  /**
   *
   * @type {string}
   * @memberof WeatherHourlyEntry
   */
  providerWeatherCode: string
}

/**
 * @export
 */
export const WeatherHourlyEntryConditionEnum = {
  clear: 'clear',
  partly_cloudy: 'partly_cloudy',
  cloudy: 'cloudy',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  sleet: 'sleet',
  snow: 'snow',
  thunderstorm: 'thunderstorm',
  wind: 'wind',
  unknown: 'unknown',
} as const
export type WeatherHourlyEntryConditionEnum =
  (typeof WeatherHourlyEntryConditionEnum)[keyof typeof WeatherHourlyEntryConditionEnum]

/**
 *
 * @export
 */
export const WeatherProvider = {
  openweather: 'openweather',
  weatherapi: 'weatherapi',
} as const
export type WeatherProvider = (typeof WeatherProvider)[keyof typeof WeatherProvider]

/**
 *
 * @export
 * @interface WeatherSnapshot
 */
export interface WeatherSnapshot {
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshot
   */
  locationKey: string
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshot
   */
  latitude: number
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshot
   */
  longitude: number
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshot
   */
  timezone: string
  /**
   *
   * @type {WeatherSnapshotProviderEnum}
   * @memberof WeatherSnapshot
   */
  provider: WeatherSnapshotProviderEnum
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshot
   */
  providerUpdatedAt: string
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshot
   */
  fetchedAt: string
  /**
   *
   * @type {WeatherSnapshotCurrent}
   * @memberof WeatherSnapshot
   */
  current: WeatherSnapshotCurrent
  /**
   *
   * @type {Array<WeatherSnapshotHourlyInner>}
   * @memberof WeatherSnapshot
   */
  hourly: FixedLengthArray<WeatherSnapshotHourlyInner, 48>
  /**
   *
   * @type {Array<WeatherSnapshotAlertsInner>}
   * @memberof WeatherSnapshot
   */
  alerts: Array<WeatherSnapshotAlertsInner>
}

/**
 * @export
 */
export const WeatherSnapshotProviderEnum = {
  openweather: 'openweather',
  weatherapi: 'weatherapi',
} as const
export type WeatherSnapshotProviderEnum =
  (typeof WeatherSnapshotProviderEnum)[keyof typeof WeatherSnapshotProviderEnum]

/**
 *
 * @export
 * @interface WeatherSnapshotAlertsInner
 */
export interface WeatherSnapshotAlertsInner {
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshotAlertsInner
   */
  event: string
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshotAlertsInner
   */
  description: string
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshotAlertsInner
   */
  start: string
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshotAlertsInner
   */
  end: string
  /**
   *
   * @type {WeatherSnapshotAlertsInnerSeverityEnum}
   * @memberof WeatherSnapshotAlertsInner
   */
  severity?: WeatherSnapshotAlertsInnerSeverityEnum
}

/**
 * @export
 */
export const WeatherSnapshotAlertsInnerSeverityEnum = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type WeatherSnapshotAlertsInnerSeverityEnum =
  (typeof WeatherSnapshotAlertsInnerSeverityEnum)[keyof typeof WeatherSnapshotAlertsInnerSeverityEnum]

/**
 *
 * @export
 * @interface WeatherSnapshotCurrent
 */
export interface WeatherSnapshotCurrent {
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshotCurrent
   */
  temperature: number
  /**
   *
   * @type {WeatherSnapshotCurrentConditionEnum}
   * @memberof WeatherSnapshotCurrent
   */
  condition: WeatherSnapshotCurrentConditionEnum
}

/**
 * @export
 */
export const WeatherSnapshotCurrentConditionEnum = {
  clear: 'clear',
  partly_cloudy: 'partly_cloudy',
  cloudy: 'cloudy',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  sleet: 'sleet',
  snow: 'snow',
  thunderstorm: 'thunderstorm',
  wind: 'wind',
  unknown: 'unknown',
} as const
export type WeatherSnapshotCurrentConditionEnum =
  (typeof WeatherSnapshotCurrentConditionEnum)[keyof typeof WeatherSnapshotCurrentConditionEnum]

/**
 *
 * @export
 * @interface WeatherSnapshotHourlyInner
 */
export interface WeatherSnapshotHourlyInner {
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshotHourlyInner
   */
  forecastAt: string
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshotHourlyInner
   */
  temperature: number
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshotHourlyInner
   */
  feelsLike: number
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshotHourlyInner
   */
  precipitationProbability: number
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshotHourlyInner
   */
  precipitationAmount: number
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshotHourlyInner
   */
  windSpeed: number
  /**
   *
   * @type {number}
   * @memberof WeatherSnapshotHourlyInner
   */
  windGust: number | null
  /**
   *
   * @type {WeatherSnapshotHourlyInnerConditionEnum}
   * @memberof WeatherSnapshotHourlyInner
   */
  condition: WeatherSnapshotHourlyInnerConditionEnum
  /**
   *
   * @type {string}
   * @memberof WeatherSnapshotHourlyInner
   */
  providerWeatherCode: string
}

/**
 * @export
 */
export const WeatherSnapshotHourlyInnerConditionEnum = {
  clear: 'clear',
  partly_cloudy: 'partly_cloudy',
  cloudy: 'cloudy',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  sleet: 'sleet',
  snow: 'snow',
  thunderstorm: 'thunderstorm',
  wind: 'wind',
  unknown: 'unknown',
} as const
export type WeatherSnapshotHourlyInnerConditionEnum =
  (typeof WeatherSnapshotHourlyInnerConditionEnum)[keyof typeof WeatherSnapshotHourlyInnerConditionEnum]

/**
 *
 * @export
 */
export const WindTolerance = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type WindTolerance = (typeof WindTolerance)[keyof typeof WindTolerance]
