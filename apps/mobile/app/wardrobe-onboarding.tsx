import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { WardrobeOnboardingScreen } from '@/src/features/wardrobe/wardrobe-onboarding-screen'

// Story CC-7.9 D6: the root stack's AppTopBar shows this title and its back control.
export default function WardrobeOnboardingRoute() {
  const { t } = useTranslation()
  return (
    <>
      <Stack.Screen options={{ title: t('wardrobe.onboarding.title') }} />
      <WardrobeOnboardingScreen />
    </>
  )
}
