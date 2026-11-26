// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA), spec D16: New post sits in the Community top bar's trailing
// slot, put there through `navigation.setOptions({ headerRight })`. A case that presses New
// post, or proves it absent, renders `CommunityTab`: the real tab top bar beside the screen.
// The suite's expo-router mock hands out `useNavigation` from `tab-navigation-store` and
// exports `router` (the top bar's module imports it); `afterEach` calls `tabNavigation.reset()`.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { CommunityScreen } from '@/src/features/community/community-screen'
import i18n from '@/src/lib/i18n'
import { TabTopBar } from '@/src/test-utils/tab-navigation'

/** Community as the tab navigator draws it: its top bar, then the screen. */
export function CommunityTab() {
  return (
    <>
      <TabTopBar title={i18n.t('tabs.community')} route="community" />
      <CommunityScreen />
    </>
  )
}
