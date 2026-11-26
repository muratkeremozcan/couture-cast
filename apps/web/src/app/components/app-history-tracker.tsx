// Story CC-7.11 D11 owner: loads the in-app history from the root layout, so its history wrappers
// are in place before the app router patches the same methods and before any navigation.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import { installAppHistory } from '../../lib/app-history'

installAppHistory()

/** Renders nothing; importing it installs the history tracking. */
export function AppHistoryTracker() {
  return null
}
