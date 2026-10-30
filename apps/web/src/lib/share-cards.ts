'use client'
import {
  SHARE_CARD_SHARED_EVENT,
  trackShareCardShared,
  decodeShareCardBase64,
  shareCardsClient,
  ResponseError,
  abortError,
  type PreparedShareCard,
  type PrepareShareCardInput,
  type ShareCardShareOutcome,
  type ShareCardShareTarget,
} from '@couture/api-client'
import { browserAnalytics } from '../analytics/browser-analytics'
import { createWebApiClient } from './api-client'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
export async function validateWebShareCard(card: PreparedShareCard) {
  const bytes = decodeShareCardBase64(card.pngBase64)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  if (hex !== card.sha256) throw new Error('invalid_png')
  return bytes
}
const memberApi = () =>
  createWebApiClient({
    accessToken: () => window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY) ?? '',
  })
export async function prepareShareCardFromWeb(
  input: PrepareShareCardInput,
  signal: AbortSignal
) {
  if (signal.aborted) throw abortError('Preparation cancelled')
  if (!navigator.onLine) throw new Error('offline')
  const card = await shareCardsClient(memberApi()).prepare(input, signal)
  await validateWebShareCard(card)
  if (signal.aborted) throw abortError('Preparation cancelled')
  return card
}
export function shareCardErrorKey(error: unknown): string {
  if (error instanceof ResponseError) {
    if (error.response.status === 409) return 'previewChanged'
    if ([401, 403, 404].includes(error.response.status)) return 'sourceUnavailable'
    if (error.response.status === 503) return 'render'
  }
  if (error instanceof Error && error.message === 'preview_changed')
    return 'previewChanged'
  return error instanceof Error && error.message === 'offline' ? 'offline' : 'unknown'
}
export async function downloadShareCard(card: PreparedShareCard, signal: AbortSignal) {
  const bytes = await validateWebShareCard(card)
  if (signal.aborted) throw abortError('Download cancelled')
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'couturecast-card.png'
  try {
    if (signal.aborted) throw abortError('Download cancelled')
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    // Browsers need the URL through the handoff task. No disk completion is claimed.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

// Story 6.9: the Web Share API path. Share appears only where the member's capability
// is on and the browser says it can share this exact kind of file (D2).
export const SHARE_CARD_FILE_NAME = 'couturecast-card.png'
export const shareCardFile = (bytes: Uint8Array) =>
  new File([bytes as BlobPart], SHARE_CARD_FILE_NAME, { type: 'image/png' })
/** Missing, false or throwing `canShare` all mean unsupported, so Download stays alone. */
export function canShareCardFiles() {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      typeof navigator.share === 'function' &&
      navigator.canShare({ files: [shareCardFile(new Uint8Array())] }) === true
    )
  } catch {
    return false
  }
}
/** Resolves off on any problem; the caller binds the answer to the member it asked for. */
export function shareCardCapabilitiesFromWeb(signal: AbortSignal) {
  return shareCardsClient(memberApi()).capabilities(signal)
}
/**
 * Reauthorizes the previewed bytes for sharing and returns them as the File to hand
 * off. Both the response digest and the decoded bytes' digest must equal the preview
 * digest; a different digest means the composition changed on the server.
 */
export async function authorizeShareCardFile(
  input: Omit<Extract<PrepareShareCardInput, { purpose: 'share' }>, 'purpose'>,
  signal: AbortSignal
) {
  const card = await prepareShareCardFromWeb({ ...input, purpose: 'share' }, signal)
  if (card.sha256 !== input.expectedSha256) throw new Error('preview_changed')
  const bytes = await validateWebShareCard(card)
  if (signal.aborted) throw abortError('Share cancelled')
  return shareCardFile(bytes)
}
export type WebShareResult = {
  outcome: Extract<ShareCardShareOutcome, 'handed_off' | 'dismissed' | 'failed'>
  target: Extract<ShareCardShareTarget, 'unknown' | 'none'>
  code?: 'activation_expired' | 'share_error'
}
/** Maps a Web Share failure onto the result model; never inspects error text. */
export function webShareFailure(error: unknown): WebShareResult {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? error.name : null
  if (name === 'AbortError') return { outcome: 'dismissed', target: 'none' }
  // The transient activation from the tap ran out during the async reauthorization.
  if (name === 'NotAllowedError')
    return { outcome: 'failed', target: 'none', code: 'activation_expired' }
  return { outcome: 'failed', target: 'none', code: 'share_error' }
}
/**
 * Calls `navigator.share` synchronously, before anything else, so a tap that already
 * holds an authorized File keeps its transient activation. Never rejects.
 */
export function handOffShareCardFile(file: File): Promise<WebShareResult> {
  let pending: Promise<void>
  try {
    pending = navigator.share({ files: [file] })
  } catch (error) {
    return Promise.resolve(webShareFailure(error))
  }
  return Promise.resolve(pending).then(
    (): WebShareResult => ({ outcome: 'handed_off', target: 'unknown' }),
    webShareFailure
  )
}
const MAX_SHARE_DURATION_MS = 86_400_000
/**
 * One share_card_shared capture for a settled attempt, timed from the tap. Called after
 * the outcome is shown; a synchronous throw or an async rejection is swallowed because
 * analytics never changes a share outcome.
 */
export function captureShareCardShared(result: WebShareResult, activatedAt: number) {
  try {
    const elapsed = Math.round(performance.now() - activatedAt)
    const properties = trackShareCardShared({
      client: 'web',
      target: result.target,
      outcome: result.outcome,
      duration_ms: Math.min(MAX_SHARE_DURATION_MS, Math.max(0, elapsed)),
    })
    const returned: unknown = browserAnalytics.capture(
      SHARE_CARD_SHARED_EVENT,
      properties
    )
    if (returned instanceof Promise) returned.catch(() => undefined)
  } catch {
    // Swallowed: the member already has the outcome.
  }
}
