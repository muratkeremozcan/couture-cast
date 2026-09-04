import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { PlannerScreen } from '@/src/features/premium/planner-screen'

export default function PlannerRoute() {
  const { t } = useTranslation()
  return (
    <>
      <Stack.Screen options={{ title: t('commerce.premium.planner.sectionTitle') }} />
      <PlannerScreen />
    </>
  )
}
