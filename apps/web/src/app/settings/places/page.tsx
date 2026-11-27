import { ScreenGate } from '../../components/screen-gate'
import { LocationsSection } from '../../components/locations/locations-section'
import { SettingsDestination } from '../settings-destination'

const READS = ['locations'] as const

export default function PlacesPage() {
  return (
    <SettingsDestination topic="places">
      <ScreenGate screen="settings-places" reads={READS}>
        <LocationsSection />
      </ScreenGate>
    </SettingsDestination>
  )
}
