import { useTranslation } from 'react-i18next'

import { TabDestinationScreen } from '@/components/tab-destination-screen'

export default function CommunityScreen() {
  const { t } = useTranslation()

  return (
    <TabDestinationScreen
      testID="community-screen"
      title={t('tabs.community', { defaultValue: 'Community' })}
    />
  )
}
