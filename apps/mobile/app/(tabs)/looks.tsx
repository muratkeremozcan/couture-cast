// Story CC-7.11 D8: the Looks tab route. The screen lives under `src/features/`, like Community;
// the tab's title and icon come from `app/(tabs)/_layout.tsx`.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { LooksScreen } from '@/src/features/looks/looks-screen'

export default function LooksRoute() {
  return <LooksScreen />
}
