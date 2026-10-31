import type { ShareCardShareAnchor } from '../../modules/share-card-native-share/types'
import type {
  ShareCardShareInput,
  ShareCardShareSettlement,
} from './share-card-share.native'
export type {
  ShareCardShareCode,
  ShareCardShareInput,
  ShareCardShareSettlement,
} from './share-card-share.native'
/** Browser/production-neutral surface: the native share sheet exists only on iOS and Android. */
export const nativeShareCardShareAvailable = () => false
export function sweepExpiredShareCardFiles(): Promise<void> {
  return Promise.resolve()
}
export function shareShareCard(
  _input: ShareCardShareInput,
  _options: {
    signal: AbortSignal
    isCurrent: () => boolean
    owner?: object
    anchor: () => Promise<ShareCardShareAnchor | null>
  }
): Promise<ShareCardShareSettlement> {
  return Promise.reject(new Error('nativeShareUnavailable'))
}
