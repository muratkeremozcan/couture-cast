import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { PaletteAdvisorScreen } from '@/src/features/premium/palette-advisor-screen'

export default function PaletteAdvisorRoute() {
  const { t } = useTranslation()
  return (
    <>
      <Stack.Screen options={{ title: t('commerce.premium.palette.sectionTitle') }} />
      <PaletteAdvisorScreen />
    </>
  )
}
