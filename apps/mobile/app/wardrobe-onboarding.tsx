import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { WardrobeOnboardingScreen } from '@/src/features/wardrobe/wardrobe-onboarding-screen'

export default function WardrobeOnboardingRoute() {
  const { t } = useTranslation()
  return (
    <>
      <Stack.Screen options={{ title: t('wardrobe.onboarding.title') }} />
      <WardrobeOnboardingScreen />
    </>
  )
}
