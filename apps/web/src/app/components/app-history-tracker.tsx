// Story CC-7.11 D11 owner: the one tracker that keeps the in-app URL stack, mounted in the root
// layout.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { recordAppUrl } from '../../lib/app-history'

function Tracker() {
  const pathname = usePathname()
  const search = useSearchParams()?.toString() ?? ''
  useEffect(() => {
    if (pathname) recordAppUrl(search ? `${pathname}?${search}` : pathname)
  }, [pathname, search])
  return null
}

/** `useSearchParams` needs its own Suspense boundary so every page still prerenders. */
export function AppHistoryTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  )
}
