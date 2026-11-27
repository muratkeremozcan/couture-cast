// Story CC-7.12 D5: the saved look route, `saved-look/<id>?from=<filter>`. The screen sets its
// own header title (the look's name); the root stack AppTopBar draws it with the back control,
// and a direct entry's back goes to Looks Saved (PARENT_TAB).
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { useCallback } from 'react'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { parseLooksFilter } from '@couture/utils'
import { getMobileTabBarHeight, setMobileTabBarHeight } from '@/components/save-feedback'
import { SavedLookDetailScreen } from '@/src/features/looks/saved-look-detail'

export default function SavedLookRoute() {
  const { savedLookId, from } = useLocalSearchParams<{
    savedLookId?: string
    from?: string
  }>()
  // This stack screen covers the tab bar, so the shared status bar sits on the safe area
  // instead of floating a tab bar's height above it. Leaving restores the tab clearance.
  useFocusEffect(
    useCallback(() => {
      const tabBarHeight = getMobileTabBarHeight()
      setMobileTabBarHeight(0)
      return () => setMobileTabBarHeight(tabBarHeight)
    }, [])
  )
  return (
    <SavedLookDetailScreen
      savedLookId={typeof savedLookId === 'string' ? savedLookId : undefined}
      // TEA T2: `from` is present only when a Saved tile opened the look.
      from={typeof from === 'string' ? parseLooksFilter(from) : null}
    />
  )
}
