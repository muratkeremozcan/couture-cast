// Story 6.12 owner: the operations channel in `apps/api/src/modules/moderation/moderation-sla.channel.ts`.
// The webhook URL is a secret. `fetch` prints a credentials URL in its error text, so the URL is
// validated before any call and no exception text ever leaves this file. Auto-instrumentation copies
// a request URL into span attributes, so the POST also runs with tracing suppressed.
import { context } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import type {
  ModerationCaseRisk,
  ModerationCaseSource,
  ModerationSlaAlertKind,
  ModerationSlaChannel,
  ModerationSlaDrillPayload,
  ModerationSlaFailureCode,
  ModerationSlaWebhookPayload,
} from '@couture/api-client/contracts/http'

export const MODERATION_OPS_WEBHOOK_TIMEOUT_MS = 5_000

export type ModerationOpsDeliveryResult = 'delivered' | ModerationSlaFailureCode

export interface ModerationOpsChannel {
  kind: ModerationSlaChannel
  /** Never rejects. */
  deliver(
    payload: ModerationSlaWebhookPayload | ModerationSlaDrillPayload
  ): Promise<ModerationOpsDeliveryResult>
}

const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function isUsableWebhookUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return (
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    LOOPBACK_IPV4.test(url.hostname)
  )
}

function failureCodeForStatus(status: number): ModerationSlaFailureCode {
  if (status >= 300 && status < 400) return 'http_3xx'
  if (status >= 400 && status < 500) return 'http_4xx'
  return 'http_5xx'
}

/** Unset, empty or whitespace means the console is the channel. Anything else is a webhook. */
export function createModerationOpsChannel(options: {
  url?: string | null
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}): ModerationOpsChannel {
  const url = options.url?.trim() ?? ''
  if (url.length === 0) {
    return { kind: 'console', deliver: () => Promise.resolve('invalid_config') }
  }
  const timeoutMs = options.timeoutMs ?? MODERATION_OPS_WEBHOOK_TIMEOUT_MS
  const send = options.fetch ?? globalThis.fetch
  const usable = isUsableWebhookUrl(url)

  return {
    kind: 'webhook',
    async deliver(payload) {
      if (!usable) return 'invalid_config'
      try {
        const response = await context.with(suppressTracing(context.active()), () =>
          send(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': payload.id,
            },
            body: JSON.stringify(payload),
            // A manual redirect exposes the status. `redirect: 'error'` throws with none, and no
            // redirect is followed either way.
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
          })
        )
        await response.body?.cancel().catch(() => undefined)
        return response.ok ? 'delivered' : failureCodeForStatus(response.status)
      } catch (error) {
        const name = error instanceof Error ? error.name : ''
        return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
      }
    },
  }
}

export interface ModerationSlaPayloadInput {
  id: string
  kind: ModerationSlaAlertKind
  source: ModerationCaseSource
  risk: ModerationCaseRisk
  slaDueAt: Date
  detectedAt: Date
  caseId: string
}

const TEXT_PREFIX: Record<ModerationSlaAlertKind, string> = {
  at_risk: 'Moderation SLA at risk',
  breached: 'Moderation SLA breached',
  escalated: 'Moderation case escalated',
}

/** `APP_URL` wins over `NEXT_PUBLIC_APP_URL`, the precedent in `stripe-billing.service.ts`. */
export function resolveModerationSlaAppUrl(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || undefined
}

/** The one builder of what a receiver sees. Nothing user-authored can reach it. */
export function buildModerationSlaPayload(
  alert: ModerationSlaPayloadInput,
  options: { appUrl?: string | null }
): ModerationSlaWebhookPayload {
  const casePath = `/moderation/cases/${alert.caseId}`
  const base = options.appUrl?.trim().replace(/\/+$/, '')
  const caseUrl = base ? `${base}${casePath}` : null
  return {
    id: alert.id,
    kind: alert.kind,
    source: alert.source,
    risk: alert.risk,
    slaDueAt: alert.slaDueAt.toISOString(),
    detectedAt: alert.detectedAt.toISOString(),
    casePath,
    caseUrl,
    text: `${TEXT_PREFIX[alert.kind]}: ${alert.risk} risk ${alert.source} case. ${caseUrl ?? casePath}`,
  }
}
