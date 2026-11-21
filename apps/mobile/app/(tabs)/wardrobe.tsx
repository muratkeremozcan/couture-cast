import { useLocalSearchParams } from 'expo-router'
import { WardrobeHubScreen } from '@/src/features/wardrobe/wardrobe-hub-screen'

export default function WardrobeScreen() {
  const { entry } = useLocalSearchParams<{ entry?: string }>()
  return <WardrobeHubScreen addEntry={entry === 'add'} />
}
