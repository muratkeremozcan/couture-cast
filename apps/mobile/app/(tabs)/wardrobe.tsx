import { useTranslation } from 'react-i18next'

import { TabDestinationScreen } from '@/components/tab-destination-screen'

export default function WardrobeScreen() {
  const { t } = useTranslation()

  return (
    <TabDestinationScreen
      testID="wardrobe-screen"
      title={t('tabs.wardrobe', { defaultValue: 'Wardrobe' })}
    />
  )
}
