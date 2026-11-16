import { router, useLocalSearchParams, type Href } from 'expo-router'
import { finishStepHref, parsePreviewFrom } from '@couture/utils'
import { SignupScreen } from '@/src/features/signup/signup-screen'
import { continuesToPreviewReview } from '@/src/lib/post-signin-destination'

export default function SignupRoute() {
  const { from, google } = useLocalSearchParams<{ from?: string; google?: string }>()
  const fromPreview = parsePreviewFrom(from) !== null
  // D5: only the three fixed outcome names a cold callback hands over; anything else shows nothing.
  const googleOutcome =
    google === 'cancelled' || google === 'unavailable' || google === 'refused'
      ? google
      : null
  return (
    <SignupScreen
      fromPreview={fromPreview}
      googleOutcome={googleOutcome}
      onGoogleSignedIn={(outcome) => {
        // A teen waiting on a guardian gets the guardian invitation on the finish step.
        if (outcome === 'no_account' || outcome === 'awaiting_guardian') {
          router.replace(
            finishStepHref(
              fromPreview ? 'preview' : null,
              'signup',
              '/signup-finish'
            ) as Href
          )
          return
        }
        void continuesToPreviewReview(fromPreview).then((review) =>
          router.replace(review ? '/preview-continue' : '/')
        )
      }}
      onPreviewNavigate={(href) =>
        href === '/preview' ? router.replace(href) : router.push(href)
      }
    />
  )
}
