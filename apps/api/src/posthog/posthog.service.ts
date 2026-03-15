import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { PostHog } from 'posthog-node'
import { createBaseLogger } from '../logger/pino.config'

export interface PostHogCaptureEvent {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

/** Story 0.7 Task 8 owner file: PostHog adapter for remote flag evaluation.
 * Why this service exists:
 * - The rest of the API should ask "what is the flag value?" instead of speaking raw PostHog SDK types.
 * - We want one place that decides what "no answer from PostHog" means.
 * Alternatives:
 * - Instantiate posthog-node directly inside feature-flag services.
 * - Return raw variant strings and make every caller normalize them.
 * Ownership anchor:
 * - Story 0.7 Task 8 step 2 owner: ask PostHog for the remote answer and return the SDK value.
 * Flow refs:
 * - S0.7/T8/1: shared config defines the legal keys/defaults and expected value kinds.
 * - S0.7/T8/3: callers treat undefined as "use fallback cache/defaults", not "overwrite cache".
 * - S0.7/T8/4: the sync path stores successful answers in Postgres for later offline reads.
 */
@Injectable()
export class PostHogService implements OnApplicationShutdown {
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

  async getFeatureFlagValue(flagKey: string, distinctId: string): Promise<unknown> {
    if (!this.client) return undefined

    try {
      // Flow ref S0.7/T8/2: return the raw SDK value. The shared config
      // package decides whether that value is valid for the specific flag's
      // declared type.
      const flagValue = await this.client.getFeatureFlag(flagKey, distinctId, {
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
