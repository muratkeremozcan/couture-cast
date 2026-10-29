import { requireOptionalNativeModule } from 'expo-modules-core'
import type { ShareCardPhotoSaveModule } from './types'
export function shareCardPhotoSaveModule(): ShareCardPhotoSaveModule | null {
  return requireOptionalNativeModule<ShareCardPhotoSaveModule>('ShareCardPhotoSave')
}
