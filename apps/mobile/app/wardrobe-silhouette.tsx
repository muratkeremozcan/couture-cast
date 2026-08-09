import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { WardrobeSilhouetteScreen } from '@/src/features/wardrobe/wardrobe-silhouette-screen'

export default function WardrobeSilhouetteRoute() {
  const { t } = useTranslation()
  return (
    <>
      <Stack.Screen options={{ title: t('wardrobe.silhouette.title') }} />
      <WardrobeSilhouetteScreen />
    </>
  )
}
