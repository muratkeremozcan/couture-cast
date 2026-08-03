// Story 3.8 Task 2 step 1 owner: implement SkipToContent link and main landmark focus target in apps/web/src/app/components/skip-to-content.tsx
'use client'

import React from 'react'

export function SkipToContent(): React.JSX.Element {
  return (
    <a
      href="#main-content"
      data-focus-surface="light"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[#C9A14A] focus:px-4 focus:py-2 focus:font-semibold focus:text-[#000000] focus:shadow-lg"
    >
      Skip to main content
    </a>
  )
}
