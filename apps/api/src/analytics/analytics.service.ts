import { Inject } from '@nestjs/common'

export type AnalyticsEventProperties = Record<string, unknown>

export type AnalyticsCaptureEvent = {
  distinctId: string
  event: string
  properties?: AnalyticsEventProperties
}

export interface AnalyticsClient {
  capture(event: AnalyticsCaptureEvent): void
}

export const ANALYTICS_CLIENT = Symbol('ANALYTICS_CLIENT')

export function InjectAnalyticsClient() {
  return Inject(ANALYTICS_CLIENT)
}
