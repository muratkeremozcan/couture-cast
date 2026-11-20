import { WardrobeBackButton } from '@/src/features/wardrobe/wardrobe-back-button'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { WardrobeSilhouetteScreen } from '@/src/features/wardrobe/wardrobe-silhouette-screen'

export default function WardrobeSilhouetteRoute() {
  const { t } = useTranslation()
  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => <WardrobeBackButton />,
          title: t('wardrobe.silhouette.title'),
        }}
      />
      <WardrobeSilhouetteScreen />
    </>
  )
}
