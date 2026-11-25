// Story CC-7.5 D3: the garment detail route, `/wardrobe-garment?id=<garment id>`. The screen
// sets its own header title and back control; see garment-detail-screen.tsx.
import { useCallback } from 'react'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { getMobileTabBarHeight, setMobileTabBarHeight } from '@/components/save-feedback'
import { GarmentDetailScreen } from '@/src/features/wardrobe/garment-detail-screen'

export default function WardrobeGarmentRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  // This stack screen covers the tab bar, so the shared status bar sits on the safe area
  // instead of floating a tab bar's height above it. Leaving restores the tab clearance.
  useFocusEffect(
    useCallback(() => {
      const tabBarHeight = getMobileTabBarHeight()
      setMobileTabBarHeight(0)
      return () => setMobileTabBarHeight(tabBarHeight)
    }, [])
  )
  return <GarmentDetailScreen garmentId={typeof id === 'string' ? id : undefined} />
}
