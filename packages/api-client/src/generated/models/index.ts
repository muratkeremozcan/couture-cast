/* eslint-disable */
export type FixedLengthArray<
  T,
  L extends number,
  Acc extends T[] = [],
> = Acc['length'] extends L ? Acc : FixedLengthArray<T, L, [...Acc, T]>

/**
 *
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
   *
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
 *
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
   *
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
}
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
   *
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
   *
   * @type {string}
   * @memberof SignupInput
   */
  birthdate: string
}
/**
 *
 * @export
 * @interface SignupResponse
 */
export interface SignupResponse {
  /**
   *
   * @type {string}
   * @memberof SignupResponse
   */
  userId: string
  /**
   *
   * @type {number}
   * @memberof SignupResponse
   */
  age: number
  /**
   *
   * @type {SignupResponseAccountStatusEnum}
   * @memberof SignupResponse
   */
  accountStatus: SignupResponseAccountStatusEnum
  /**
   *
   * @type {boolean}
   * @memberof SignupResponse
   */
  guardianConsentRequired: boolean
}

/**
 * @export
 */
export const SignupResponseAccountStatusEnum = {
  active: 'active',
  pending_guardian_consent: 'pending_guardian_consent',
} as const
export type SignupResponseAccountStatusEnum =
  (typeof SignupResponseAccountStatusEnum)[keyof typeof SignupResponseAccountStatusEnum]

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
  | AlertRuleOneOf1
  | AlertRuleOneOf2
  | UpdateAlertRulesInputRulesInnerOneOf
/**
 *
 * @export
 * @interface UpdateAlertRulesInputRulesInnerOneOf
 */
export interface UpdateAlertRulesInputRulesInnerOneOf {
  /**
   *
   * @type {UpdateAlertRulesInputRulesInnerOneOfRuleTypeEnum}
   * @memberof UpdateAlertRulesInputRulesInnerOneOf
   */
  ruleType: UpdateAlertRulesInputRulesInnerOneOfRuleTypeEnum
  /**
   *
   * @type {number}
   * @memberof UpdateAlertRulesInputRulesInnerOneOf
   */
  threshold: number
  /**
   *
   * @type {boolean}
   * @memberof UpdateAlertRulesInputRulesInnerOneOf
   */
  enabled: boolean
}

/**
 * @export
 */
export const UpdateAlertRulesInputRulesInnerOneOfRuleTypeEnum = {
  temperature: 'temperature',
} as const
export type UpdateAlertRulesInputRulesInnerOneOfRuleTypeEnum =
  (typeof UpdateAlertRulesInputRulesInnerOneOfRuleTypeEnum)[keyof typeof UpdateAlertRulesInputRulesInnerOneOfRuleTypeEnum]

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
   *
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
