import { Inject } from '@nestjs/common'

export type AnalyticsEventProperties = Record<string, unknown>

export type AnalyticsCaptureEvent = {
  distinctId: string
  event: string
  timestamp?: string
  properties?: AnalyticsEventProperties
}

export interface AnalyticsClient {
  capture(event: AnalyticsCaptureEvent): void
  captureAcknowledged?(
    event: AnalyticsCaptureEvent,
    options?: { signal?: AbortSignal }
  ): Promise<void>
}

export const ANALYTICS_CLIENT = Symbol('ANALYTICS_CLIENT')

export function InjectAnalyticsClient() {
  return Inject(ANALYTICS_CLIENT)
}
