// Story 6.3 delivery owner: post acknowledged analytics with a stable UUID in `apps/api/src/posthog/posthog.service.ts`, called from `apps/api/src/modules/telemetry/telemetry.service.ts`
import { z } from 'zod'
import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import type { FeatureFlagEvaluationSubject, FeatureFlagKey } from '@couture/config'
import { PostHog } from 'posthog-node'
import type {
  AnalyticsCaptureEvent,
  AnalyticsClient,
} from '../analytics/analytics.service'
import { createBaseLogger } from '../logger/pino.config'
import type { RemoteFeatureFlagProvider } from '../modules/feature-flags/remote-feature-flag-provider'

const remoteFlagResponseSchema = z.object({
  flags: z.record(
    z.object({
      key: z.string(),
      enabled: z.boolean(),
      variant: z.string().nullable().optional(),
      failed: z.boolean().optional(),
    })
  ),
  quotaLimited: z.array(z.unknown()).optional(),
  quota_limited: z.array(z.unknown()).optional(),
  errorsWhileComputingFlags: z.boolean().optional(),
})
function remoteFlagValue(body: unknown, flag: string): unknown {
  const result = remoteFlagResponseSchema.safeParse(body)
  if (!result.success) return undefined
  if (
    result.data.quotaLimited?.length ||
    result.data.quota_limited?.length ||
    result.data.errorsWhileComputingFlags
  )
    return undefined
  const evaluated = result.data.flags[flag]
  if (!evaluated || evaluated.key !== flag || evaluated.failed) return undefined
  return evaluated.variant ?? evaluated.enabled
}

export type PostHogCaptureEvent = AnalyticsCaptureEvent

/** Story 0.7 Task 8 owner file: PostHog adapter for analytics capture and remote flag evaluation.
 * Why this service exists:
 * - The rest of the API should depend on repo-local analytics and flag interfaces instead of
 *   speaking raw PostHog SDK types.
 * - We want one place that decides what "no answer from PostHog" means.
 * Alternatives:
 * - Instantiate posthog-node directly inside feature-flag services.
 * - Inject the vendor SDK into every analytics call site.
 * - Return raw variant strings and make every caller normalize them.
 * Ownership anchor:
 * - Story 0.7 Task 8 step 2 owner: ask PostHog for the remote answer and return the SDK value.
 * Flow refs:
 * - S0.7/T8/1: shared config defines the legal keys/defaults and expected value kinds.
 * - S0.7/T8/3: callers treat undefined as "use fallback cache/defaults", not "overwrite cache".
 * - S0.7/T8/4: the sync path stores successful answers in Postgres for later offline reads.
 * - S0.7/T8.5/1-4: PostHog remains the concrete provider, but the rest of the API now reaches it
 *   through repo-local analytics and feature-flag interfaces.
 */
@Injectable()
export class PostHogService
  implements OnApplicationShutdown, AnalyticsClient, RemoteFeatureFlagProvider
{
  private readonly logger = createBaseLogger().child({ feature: 'posthog' })
  private readonly client: PostHog | null

  constructor() {
    // If the SDK is not configured, we intentionally behave like "remote answer
    // unavailable" instead of throwing during app bootstrap.
    const apiKey = process.env.POSTHOG_API_KEY
    if (!apiKey) {
      this.client = null
      return
    }

    this.client = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    })
  }

  capture({ distinctId, event, properties }: PostHogCaptureEvent): void {
    if (!this.client) return

    try {
      this.client.capture({
        distinctId,
        event,
        properties,
      })
    } catch (error) {
      this.logger.warn({ err: error, event }, 'posthog_capture_failed')
    }
  }

  /**
   * Story 6.3: outbox acknowledgement uses the ingestion HTTP response.
   * posthog-node captureImmediate also catches delivery failures in this installed
   * version. This transport leaves retry ownership with the durable outbox.
   * Wire format: https://posthog.com/docs/api and https://posthog.com/docs/data/anonymous-vs-identified-events
   */
  async captureAcknowledged(
    { distinctId, event, timestamp, properties }: PostHogCaptureEvent,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const apiKey = process.env.POSTHOG_API_KEY
    if (!apiKey) throw new Error('Analytics ingestion is unconfigured')
    const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'
    const response = await fetch(`${host.replace(/\/+$/, '')}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        timestamp,
        distinct_id: distinctId,
        uuid: properties?.$insert_id,
        properties: {
          ...properties,
          $geoip_disable: true,
          $process_person_profile: false,
        },
      }),
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)])
        : AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error(`Analytics ingestion refused: ${response.status}`)
    const acknowledgement: unknown = await response.json()
    if (
      typeof acknowledgement === 'object' &&
      acknowledgement !== null &&
      'quota_limited' in acknowledgement &&
      Array.isArray(acknowledgement.quota_limited) &&
      acknowledgement.quota_limited.length > 0
    )
      throw new Error('Analytics ingestion quota limited')
    if (
      acknowledgement !== 1 &&
      !(
        typeof acknowledgement === 'object' &&
        acknowledgement !== null &&
        'status' in acknowledgement &&
        acknowledgement.status === 1
      )
    )
      throw new Error('Analytics ingestion acknowledgement invalid')
  }

  async getFeatureFlagValue(
    flagKey: FeatureFlagKey,
    subjectId: FeatureFlagEvaluationSubject,
    options?: { signal: AbortSignal }
  ): Promise<unknown> {
    if (!this.client) return undefined
    if (options) return this.getRemoteFeatureFlag(flagKey, subjectId, options.signal)

    try {
      // Flow ref S0.7/T8/2: return the raw SDK value. The shared config
      // package decides whether that value is valid for the specific flag's
      // declared type.
      const flagValue = await this.client.getFeatureFlag(flagKey, subjectId, {
        sendFeatureFlagEvents: false,
      })

      return flagValue === undefined ? undefined : flagValue
    } catch (error) {
      // Flow ref S0.7/T8/3: undefined means "fall back safely" rather than
      // "remote false". That distinction prevents outage-driven cache
      // corruption.
      this.logger.warn({ err: error, flagKey }, 'posthog_feature_flag_failed')
      return undefined
    }
  }

  private async getRemoteFeatureFlag(
    flagKey: FeatureFlagKey,
    subjectId: FeatureFlagEvaluationSubject,
    signal: AbortSignal
  ): Promise<unknown> {
    // Community owns retries and a shared database claim. One invocation is one HTTP call.
    const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'
    const response = await fetch(`${host.replace(/\/+$/, '')}/flags?v=2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'posthog-node/couturecast-community',
      },
      body: JSON.stringify({
        api_key: process.env.POSTHOG_API_KEY,
        distinct_id: subjectId,
        flag_keys_to_evaluate: [flagKey],
      }),
      signal: signal,
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    return remoteFlagValue(body, flagKey)
  }

  onApplicationShutdown(): void {
    if (!this.client) return

    try {
      void this.client.shutdown()
    } catch (error) {
      this.logger.warn({ err: error }, 'posthog_shutdown_failed')
    }
  }
}
