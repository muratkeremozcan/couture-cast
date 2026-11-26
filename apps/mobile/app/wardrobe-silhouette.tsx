import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { WardrobeSilhouetteScreen } from '@/src/features/wardrobe/wardrobe-silhouette-screen'

// Story CC-7.9 D6: the root stack's AppTopBar shows this title and its back control.
export default function WardrobeSilhouetteRoute() {
  const { t } = useTranslation()
  return (
    <>
      <Stack.Screen options={{ title: t('wardrobe.silhouette.title') }} />
      <WardrobeSilhouetteScreen />
    </>
  )
}
