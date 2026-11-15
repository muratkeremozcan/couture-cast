import { router, useLocalSearchParams } from 'expo-router'
import { parsePreviewFrom } from '@couture/utils'
import { SignupScreen } from '@/src/features/signup/signup-screen'

export default function SignupRoute() {
  const { from } = useLocalSearchParams<{ from?: string }>()
  return (
    <SignupScreen
      fromPreview={parsePreviewFrom(from) !== null}
      onPreviewNavigate={(href) =>
        href === '/preview' ? router.replace(href) : router.push(href)
      }
    />
  )
}
