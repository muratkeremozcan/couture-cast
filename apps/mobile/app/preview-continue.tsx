// Story 6.16: route shim for the post sign-in carryover review.
import { useEffect } from 'react'
import { useNavigation } from 'expo-router'
import { GUEST_PREVIEW_SAVE_INTENT } from '@couture/utils'
import { GuestPreviewReviewScreen } from '@/src/features/preview/guest-preview-review-screen'
import { mobileGuestPreviewStore } from '@/src/lib/guest-preview-store'

export default function PreviewReviewRoute() {
  const navigation = useNavigation()
  useEffect(() => {
    const store = mobileGuestPreviewStore()
    const offered = store.load().then(({ state }) => state?.conversion)
    return navigation.addListener('beforeRemove', () => {
      void offered.then((offer) => {
        if (offer?.intent !== GUEST_PREVIEW_SAVE_INTENT) return
        const current = store.snapshot().state?.conversion
        if (current?.intent === GUEST_PREVIEW_SAVE_INTENT && current.key === offer.key) {
          store.clear()
        }
      })
    })
  }, [navigation])
  return <GuestPreviewReviewScreen />
}
