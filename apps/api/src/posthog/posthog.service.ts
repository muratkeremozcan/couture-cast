import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import { PostHog } from 'posthog-node'

export interface PostHogCaptureEvent {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

@Injectable()
export class PostHogService implements OnApplicationShutdown {
  private readonly logger = new Logger(PostHogService.name)
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
      this.logger.warn(`PostHog capture failed for "${event}"`, error as Error)
    }
  }

  onApplicationShutdown(): void {
    if (!this.client) return

    try {
      void this.client.shutdown()
    } catch (error) {
      this.logger.warn('PostHog shutdown failed', error as Error)
    }
  }
}
