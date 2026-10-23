import { useLocalSearchParams } from 'expo-router'
import { LocationsScreen } from '@/src/features/locations/locations-screen'

/** Story 1.2b: `?guided=1` marks entry from a no-location state. The title is set in `_layout.tsx`. */
export default function LocationsRoute() {
  const { guided } = useLocalSearchParams<{ guided?: string }>()
  return <LocationsScreen guided={guided === '1'} />
}
