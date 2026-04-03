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
