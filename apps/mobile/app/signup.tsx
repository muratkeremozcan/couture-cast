import { router, useLocalSearchParams } from 'expo-router'
import { parsePreviewFrom } from '@couture/utils'
import { SignupScreen } from '@/src/features/signup/signup-screen'
import { continuesToPreviewReview } from '@/src/lib/post-signin-destination'

export default function SignupRoute() {
  const { from } = useLocalSearchParams<{ from?: string }>()
  const fromPreview = parsePreviewFrom(from) !== null
  return (
    <SignupScreen
      fromPreview={fromPreview}
      onGoogleSignedIn={(outcome) => {
        if (outcome === 'no_account') {
          router.replace(fromPreview ? '/signup-finish?from=preview' : '/signup-finish')
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
