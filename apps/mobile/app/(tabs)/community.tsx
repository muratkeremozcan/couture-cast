import { CommunityScreen } from '@/src/features/community/community-screen'

/**
 * Route shim only. The screen itself lives under `src/features/`, following
 * `app/planner.tsx`, `app/palette-advisor.tsx`, `app/signup.tsx` and
 * `app/wardrobe-onboarding.tsx`; a 900-line screen inside `app/(tabs)/` was the
 * outlier. The tab's title and icon come from `app/(tabs)/_layout.tsx`, so
 * unlike the stack routes above this shim renders no `Stack.Screen`.
 */
export default function CommunityRoute() {
  return <CommunityScreen />
}
