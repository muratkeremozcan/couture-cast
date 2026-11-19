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
export const MODERATION_OPS_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'

/**
 * The push channel's view of who moderates: the Expo tokens, with push permission granted, of the
 * accounts named in `MODERATION_OPS_PUSH_USER_IDS`. Injected, so this file holds no database code.
 */
export type ModerationOpsPushTokens = (userIds: readonly string[]) => Promise<string[]>

/** `MODERATION_OPS_PUSH_USER_IDS`: comma or whitespace separated account ids, duplicates dropped. */
export function parseModerationOpsPushUserIds(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\s,]+/).filter((id) => id.length > 0))]
}

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

/**
 * A configured webhook wins. Without one, moderator accounts named for push make the channel push
 * to their devices. With neither, the console is the channel.
 */
export function createModerationOpsChannel(options: {
  url?: string | null
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
  push?: {
    userIds: readonly string[]
    tokens: ModerationOpsPushTokens
    endpoint?: string
    accessToken?: string | null
    onAccepted?: ModerationOpsPushAccepted
  }
}): ModerationOpsChannel {
  const url = options.url?.trim() ?? ''
  const timeoutMs = options.timeoutMs ?? MODERATION_OPS_WEBHOOK_TIMEOUT_MS
  const send = options.fetch ?? globalThis.fetch
  if (url.length === 0) {
    if (options.push && options.push.userIds.length > 0)
      return createModerationOpsPushChannel({ ...options.push, timeoutMs, send })
    return { kind: 'console', deliver: () => Promise.resolve('invalid_config') }
  }
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

/** Expo accepts at most this many messages in one request. */
export const MODERATION_OPS_PUSH_BATCH_LIMIT = 100
export const MODERATION_OPS_PUSH_RECEIPTS_ENDPOINT =
  'https://exp.host/--/api/v2/push/getReceipts'
/** Expo accepts at most this many ids in one receipt lookup. */
export const MODERATION_OPS_PUSH_RECEIPT_BATCH_LIMIT = 1000
/**
 * The Android channel these alerts post to: `community`, which every registered app version
 * creates before it registers a token. Android drops a notification aimed at a channel the
 * device lacks while Expo still accepts it, so a dedicated channel would silently miss every
 * moderator still on an older build.
 */
export const MODERATION_SLA_ANDROID_CHANNEL_ID = 'community'

/**
 * What a moderator's lock screen shows. A device can outlive its moderator (a role removed, a
 * logout that never reached the server), so the notification names no case, risk, source or link:
 * those stay behind the console's role check.
 */
export const MODERATION_SLA_PUSH_TITLE = 'Moderation needs attention'
export const MODERATION_SLA_PUSH_BODY = 'Open the moderation console to review the queue.'

/** Expo's structured errors that mean the configuration, not the moment, is wrong. */
const CONFIGURATION_ERRORS = new Set([
  'DeviceNotRegistered',
  'InvalidCredentials',
  'MismatchSenderId',
])

type ExpoTicket = { status?: unknown; id?: unknown; details?: { error?: unknown } }

function ticketsOf(body: unknown): ExpoTicket[] {
  if (!body || typeof body !== 'object' || !('data' in body)) return []
  const data = (body as { data: unknown }).data
  return Array.isArray(data)
    ? (data.filter((t) => t && typeof t === 'object') as ExpoTicket[])
    : []
}

function acceptedId(ticket: ExpoTicket): string | null {
  return ticket.status === 'ok' && typeof ticket.id === 'string' && ticket.id.length > 0
    ? ticket.id
    : null
}

function ticketError(ticket: ExpoTicket): string | null {
  const error = ticket.details?.error
  return ticket.status === 'error' && typeof error === 'string' ? error : null
}

/**
 * Called with the ticket ids Expo accepted for one alert, before the alert counts as delivered,
 * so the sweep can record them and read their receipts across restarts.
 */
export type ModerationOpsPushAccepted = (
  alertId: string,
  ticketIds: readonly string[]
) => Promise<void>

/**
 * Expo push to every granted device of the named moderator accounts, in batches of at most 100.
 * Delivered means Expo accepted at least one message with a ticket id: acceptance, not arrival.
 * A failure Expo reports later (an uninstalled app, revoked credentials) arrives in the receipt,
 * which the sweep reads from the recorded ticket ids (`readExpoPushReceipts`).
 */
function createModerationOpsPushChannel(options: {
  userIds: readonly string[]
  tokens: ModerationOpsPushTokens
  endpoint?: string
  accessToken?: string | null
  timeoutMs: number
  send: typeof globalThis.fetch
  onAccepted?: ModerationOpsPushAccepted
}): ModerationOpsChannel {
  const endpoint = options.endpoint ?? MODERATION_OPS_PUSH_ENDPOINT
  const headers = expoHeaders(options.accessToken)
  const post = (url: string, body: unknown) =>
    context.with(suppressTracing(context.active()), () =>
      options.send(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    )
  /** One request per batch of at most 100. A failed batch never hides an accepted one. */
  const sendBatches = async (messages: readonly unknown[]) => {
    const accepted: string[] = []
    const errors: string[] = []
    let transport: ModerationOpsDeliveryResult | null = null
    for (
      let start = 0;
      start < messages.length;
      start += MODERATION_OPS_PUSH_BATCH_LIMIT
    ) {
      try {
        const response = await post(
          endpoint,
          messages.slice(start, start + MODERATION_OPS_PUSH_BATCH_LIMIT)
        )
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined)
          transport ??= failureCodeForStatus(response.status)
          continue
        }
        for (const ticket of ticketsOf(await response.json())) {
          const id = acceptedId(ticket)
          if (id) accepted.push(id)
          else errors.push(ticketError(ticket) ?? 'invalid_ticket')
        }
      } catch (error) {
        // Reading the body runs under the same timeout signal, so a slow body is a timeout too.
        const name = error instanceof Error ? error.name : ''
        transport ??=
          name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
      }
    }
    return { accepted, errors, transport }
  }

  return {
    kind: 'push',
    async deliver(payload) {
      let tokens: string[]
      try {
        tokens = await options.tokens(options.userIds)
      } catch {
        return 'network'
      }
      if (tokens.length === 0) return 'invalid_config'
      const messages = tokens.map((to) => ({
        to,
        title: MODERATION_SLA_PUSH_TITLE,
        body: MODERATION_SLA_PUSH_BODY,
        priority: 'high',
        sound: 'default',
        channelId: MODERATION_SLA_ANDROID_CHANNEL_ID,
        data: { version: 1, source: 'moderation_sla' },
      }))
      const { accepted, errors, transport } = await sendBatches(messages)
      if (accepted.length > 0) {
        // Expo accepted the push, so the alert is delivered even if recording the tickets fails:
        // `deliver` never rejects, and a rejection here would make the next claim push again.
        // The caller logs a failed record; only that alert's receipts are lost.
        await options.onAccepted?.(payload.id, accepted).catch(() => undefined)
        return 'delivered'
      }
      return failureOutcome(errors, transport)
    },
  }
}

function expoHeaders(accessToken?: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}

/** One receipt as Expo reports it: `ok`, or `error` with Expo's error code. */
export type ExpoPushReceipt = { status: 'ok' } | { status: 'error'; error: string }

/**
 * Reads Expo receipts for the given ticket ids, in lookups of at most 1000. An id Expo has no
 * receipt for yet is absent from the map. Throws when a lookup fails, so the caller retries.
 */
export async function readExpoPushReceipts(
  ids: readonly string[],
  options: {
    send?: typeof globalThis.fetch
    endpoint?: string
    accessToken?: string | null
    timeoutMs?: number
  } = {}
): Promise<Map<string, ExpoPushReceipt>> {
  const send = options.send ?? globalThis.fetch
  const endpoint = options.endpoint ?? MODERATION_OPS_PUSH_RECEIPTS_ENDPOINT
  const receipts = new Map<string, ExpoPushReceipt>()
  for (
    let start = 0;
    start < ids.length;
    start += MODERATION_OPS_PUSH_RECEIPT_BATCH_LIMIT
  ) {
    const response = await context.with(suppressTracing(context.active()), () =>
      send(endpoint, {
        method: 'POST',
        headers: expoHeaders(options.accessToken),
        body: JSON.stringify({
          ids: ids.slice(start, start + MODERATION_OPS_PUSH_RECEIPT_BATCH_LIMIT),
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(
          options.timeoutMs ?? MODERATION_OPS_WEBHOOK_TIMEOUT_MS
        ),
      })
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`receipt lookup answered ${response.status}`)
    }
    const body: unknown = await response.json()
    const data =
      body && typeof body === 'object' && 'data' in body
        ? (body as { data: unknown }).data
        : null
    if (!data || typeof data !== 'object')
      throw new Error('receipt lookup returned no data')
    for (const [id, receipt] of Object.entries(data as Record<string, ExpoTicket>)) {
      if (receipt?.status === 'ok') receipts.set(id, { status: 'ok' })
      else if (receipt?.status === 'error')
        receipts.set(id, {
          status: 'error',
          error: ticketError(receipt) ?? 'unknown_error',
        })
    }
  }
  return receipts
}

/** Why nothing was accepted: a transport failure first, then Expo's structured errors. */
function failureOutcome(
  errors: string[],
  transport: ModerationOpsDeliveryResult | null
): ModerationOpsDeliveryResult {
  if (transport) return transport
  if (errors.length > 0 && errors.every((error) => CONFIGURATION_ERRORS.has(error)))
    return 'invalid_config'
  return 'http_4xx'
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
