// Story 6.17 D3: route for the Google finish step.
import { router, useLocalSearchParams } from 'expo-router'
import { parsePreviewFrom } from '@couture/utils'
import { FinishSignupScreen } from '@/src/features/signup/finish-signup-screen'
import { mobileGuestPreviewStore } from '@/src/lib/guest-preview-store'
import { continuesToPreviewReview } from '@/src/lib/post-signin-destination'

export default function SignupFinishRoute() {
  const { from } = useLocalSearchParams<{ from?: string }>()
  const fromPreview = parsePreviewFrom(from) !== null
  return (
    <FinishSignupScreen
      onUnderage={() => {
        if (fromPreview) mobileGuestPreviewStore().clear()
      }}
      onExit={(exit) => {
        if (exit === 'continue') {
          void continuesToPreviewReview(fromPreview).then((review) =>
            router.replace(review ? '/preview-continue' : '/')
          )
          return
        }
        if (exit === 'home') router.replace('/')
        else if (exit === 'cancelled')
          router.replace(fromPreview ? '/preview' : '/signin')
        else router.replace(fromPreview ? '/signin?from=preview' : '/signin')
      }}
    />
  )
}
