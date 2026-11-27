import { ScreenGate } from '../../components/screen-gate'
import { PremiumThemeSection } from '../../components/premium-theme-section'
import { SubscriptionSection } from '../../components/subscription-section'
import { SettingsDestination } from '../settings-destination'

const READS = ['subscription', 'theme'] as const

export default function PremiumPage() {
  return (
    <SettingsDestination topic="premium">
      <ScreenGate screen="settings-premium" reads={READS}>
        <SubscriptionSection />
        <PremiumThemeSection />
      </ScreenGate>
    </SettingsDestination>
  )
}
