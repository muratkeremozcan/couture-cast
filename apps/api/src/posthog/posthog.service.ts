import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { PostHog } from 'posthog-node'
import { createBaseLogger } from '../logger/pino.config'

export interface PostHogCaptureEvent {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

@Injectable()
export class PostHogService implements OnApplicationShutdown {
  private readonly logger = createBaseLogger().child({ feature: 'posthog' })
  private readonly client: PostHog | null

  constructor() {
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

  onApplicationShutdown(): void {
    if (!this.client) return

    try {
      void this.client.shutdown()
    } catch (error) {
      this.logger.warn({ err: error }, 'posthog_shutdown_failed')
    }
  }
}
