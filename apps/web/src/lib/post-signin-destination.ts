import { webGuestPreviewStore } from './guest-preview'

/**
 * Story 6.16 D7, D8 (shared with 6.17): a sign-in that came from the preview
 * (`from=preview`) with a stored carryover intent goes to the review step. Any other sign-in
 * deletes guest state, so a proposal left on a shared device never reaches whoever signs in
 * next. Email codes and Google use the same rule.
 */
export async function destinationAfterSignIn(fromPreview: boolean): Promise<string> {
  const store = webGuestPreviewStore()
  const snapshot = await store.load()
  if (fromPreview && snapshot.state?.conversion) return '/preview/continue'
  store.clear()
  await store.flush()
  return '/'
}
