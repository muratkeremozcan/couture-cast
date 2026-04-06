/* eslint-disable */
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
