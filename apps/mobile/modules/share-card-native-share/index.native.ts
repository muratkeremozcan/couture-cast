import { requireOptionalNativeModule } from 'expo-modules-core'
import type { ShareCardNativeShareModule } from './types'
export function shareCardNativeShareModule(): ShareCardNativeShareModule | null {
  return requireOptionalNativeModule<ShareCardNativeShareModule>('ShareCardNativeShare')
}
