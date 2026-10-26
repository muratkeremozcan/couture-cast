import type { PreparedShareCard } from '@couture/api-client'
export const nativeShareCardSaveAvailable = () => false
export function shareCardSavePermission(_request: boolean) {
  return Promise.resolve({ granted: false, canAskAgain: false })
}
export function cleanOrphanShareCards(): Promise<void> {
  return Promise.resolve()
}
export function saveShareCard(
  _card: PreparedShareCard,
  _signal: AbortSignal,
  _isCurrent: () => boolean
): Promise<void> {
  return Promise.reject(new Error('nativeSaveUnavailable'))
}
