'use client'

import { createGuestPreviewBirthdateHandoff } from '@couture/utils'
import { webGuestPreviewStore } from './guest-preview'

export const webGuestPreviewBirthdate = createGuestPreviewBirthdateHandoff(
  () => webGuestPreviewStore().snapshot().state
)
