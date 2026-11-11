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
  /** False when `captureAcknowledged` can deliver nothing in this process. Absent means it can. */
  acknowledgedCaptureConfigured?(): boolean
}

/**
 * Whether an acknowledged delivery can succeed in this process at all.
 * An outbox checks this before it leases a row, so an unconfigured sink parks the row for a
 * configured process and costs no database round trip.
 */
export function acknowledgedCaptureAvailable(
  client: Pick<AnalyticsClient, 'captureAcknowledged' | 'acknowledgedCaptureConfigured'>
): boolean {
  if (typeof client.captureAcknowledged !== 'function') return false
  return client.acknowledgedCaptureConfigured?.() ?? true
}

export const ANALYTICS_CLIENT = Symbol('ANALYTICS_CLIENT')

export function InjectAnalyticsClient() {
  return Inject(ANALYTICS_CLIENT)
}
