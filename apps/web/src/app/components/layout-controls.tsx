// Story 3.5 Task 3 step 1 owner: implement comparison mode and mobile preview toggle controls with telemetry in apps/web/src/app/components/layout-controls.tsx
'use client'

import posthog from 'posthog-js'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

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
  const { t } = useTranslation('translation', { i18n: getI18n() })
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
      aria-label={t('landing.layoutControls.label')}
      data-surface="card"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card p-3"
    >
      <button
        type="button"
        onClick={handleComparisonClick}
        aria-pressed={isComparisonMode}
        className={`rounded-lg border px-4 py-2 text-xs font-semibold uppercase tracking-wider motion-safe:transition-colors motion-safe:duration-200 motion-reduce:transition-none ${
          isComparisonMode
            ? 'border-inverse bg-inverse text-on-inverse'
            : 'border-line-strong bg-page text-ink'
        }`}
      >
        {t('landing.layoutControls.comparison')}
      </button>

      <button
        type="button"
        onClick={handleMobilePreviewClick}
        aria-pressed={isMobilePreview}
        className={`rounded-lg border px-4 py-2 text-xs font-semibold uppercase tracking-wider motion-safe:transition-colors motion-safe:duration-200 motion-reduce:transition-none ${
          isMobilePreview
            ? 'border-inverse bg-inverse text-on-inverse'
            : 'border-line-strong bg-page text-ink'
        }`}
      >
        {t('landing.layoutControls.mobilePreview')}
      </button>
    </div>
  )
}
