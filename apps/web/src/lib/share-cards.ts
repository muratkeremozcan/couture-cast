'use client'
import {
  decodeShareCardBase64,
  shareCardsClient,
  ResponseError,
  abortError,
  type PreparedShareCard,
  type PrepareShareCardInput,
} from '@couture/api-client'
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
export async function prepareShareCardFromWeb(
  input: PrepareShareCardInput,
  signal: AbortSignal
) {
  if (signal.aborted) throw abortError('Preparation cancelled')
  if (!navigator.onLine) throw new Error('offline')
  const api = createWebApiClient({
    accessToken: () => window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY) ?? '',
  })
  const card = await shareCardsClient(api).prepare(input, signal)
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
