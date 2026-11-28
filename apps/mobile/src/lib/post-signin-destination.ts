import { mobileGuestPreviewStore } from './guest-preview-store'
import { GUEST_PREVIEW_SAVE_INTENT } from '@couture/utils'

export async function hasGuestLookSave() {
  const { state } = await mobileGuestPreviewStore().load()
  return state?.conversion?.intent === GUEST_PREVIEW_SAVE_INTENT
}

/**
 * Story 6.16 D7, D8 (shared with 6.17): a sign-in that came from the preview with a stored
 * carryover intent goes to the review step. Any other sign-in deletes guest state, so a
 * proposal left on a shared device never reaches whoever signs in next. Email codes and
 * Google use the same rule.
 */
export async function continuesToPreviewReview(fromPreview: boolean): Promise<boolean> {
  const store = mobileGuestPreviewStore()
  const snapshot = await store.load()
  if (fromPreview && snapshot.state?.conversion) return true
  store.clear()
  await store.flush()
  return false
}
