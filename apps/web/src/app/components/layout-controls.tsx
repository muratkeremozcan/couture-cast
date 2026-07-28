// Story 3.5 Task 3 step 1 owner: implement comparison mode and mobile preview toggle controls with telemetry in apps/web/src/app/components/layout-controls.tsx
'use client'

import posthog from 'posthog-js'

export interface LayoutControlsProps {
  isComparisonMode: boolean
  onToggleComparison: () => void
  isMobilePreview: boolean
  onToggleMobilePreview: () => void
}

export function LayoutControls({
  isComparisonMode,
  onToggleComparison,
  isMobilePreview,
  onToggleMobilePreview,
}: LayoutControlsProps) {
  const handleComparisonClick = () => {
    onToggleComparison()
    try {
      if (typeof window !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture('layout_interaction', {
          action: 'toggle_comparison',
          target: 'comparison_mode_button',
        })
      }
    } catch {
      // Telemetry fallback
    }
  }

  const handleMobilePreviewClick = () => {
    onToggleMobilePreview()
    try {
      if (typeof window !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture('layout_interaction', {
          action: 'toggle_mobile_preview',
          target: 'mobile_preview_button',
        })
      }
    } catch {
      // Telemetry fallback
    }
  }

  return (
    <div
      aria-label="Layout Controls"
      className="flex flex-wrap items-center gap-3 rounded-[8px] border border-[#E6E6ED] bg-[#F5F5F7] p-3"
    >
      <button
        type="button"
        onClick={handleComparisonClick}
        aria-pressed={isComparisonMode}
        className={`rounded-lg border px-4 py-2 text-xs font-semibold uppercase tracking-wider motion-safe:transition-colors motion-safe:duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A] ${
          isComparisonMode
            ? 'border-[#C9A14A] bg-[#C9A14A] text-[#111111]'
            : 'border-[#E6E6ED] bg-[#FFFFFF] text-[#111111]'
        }`}
      >
        Comparison Mode
      </button>

      <button
        type="button"
        onClick={handleMobilePreviewClick}
        aria-pressed={isMobilePreview}
        className={`rounded-lg border px-4 py-2 text-xs font-semibold uppercase tracking-wider motion-safe:transition-colors motion-safe:duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A] ${
          isMobilePreview
            ? 'border-[#C9A14A] bg-[#C9A14A] text-[#111111]'
            : 'border-[#E6E6ED] bg-[#FFFFFF] text-[#111111]'
        }`}
      >
        Mobile Preview
      </button>
    </div>
  )
}
