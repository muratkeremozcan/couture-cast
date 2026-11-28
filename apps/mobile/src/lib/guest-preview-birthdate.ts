import { createGuestPreviewBirthdateHandoff } from '@couture/utils'
import { mobileGuestPreviewStore } from './guest-preview-store'

export const mobileGuestPreviewBirthdate = createGuestPreviewBirthdateHandoff(
  () => mobileGuestPreviewStore().snapshot().state
)
