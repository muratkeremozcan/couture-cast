import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import type { FeatureFlagEvaluationSubject, FeatureFlagKey } from '@couture/config'
import { PostHog } from 'posthog-node'
import type {
  AnalyticsCaptureEvent,
  AnalyticsClient,
} from '../analytics/analytics.service'
import { createBaseLogger } from '../logger/pino.config'
import type { RemoteFeatureFlagProvider } from '../modules/feature-flags/remote-feature-flag-provider'

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

  async getFeatureFlagValue(
    flagKey: FeatureFlagKey,
    subjectId: FeatureFlagEvaluationSubject
  ): Promise<unknown> {
    if (!this.client) return undefined

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

  onApplicationShutdown(): void {
    if (!this.client) return

    try {
      void this.client.shutdown()
    } catch (error) {
      this.logger.warn({ err: error }, 'posthog_shutdown_failed')
    }
  }
}
