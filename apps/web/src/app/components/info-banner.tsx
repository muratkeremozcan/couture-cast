'use client'

// Story 3.7 Task 4 step 1 owner: implement web reusable info banner for invalid deep link notifications
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

export interface InfoBannerProps {
  message: string
  onDismiss?: () => void
}

export function InfoBanner({ message, onDismiss }: InfoBannerProps) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) {
    return null
  }

  const handleDismiss = () => {
    setIsVisible(false)
    if (onDismiss) {
      onDismiss()
    }
  }

  return (
    <div
      aria-live="polite"
      role="status"
      data-testid="deep-link-info-banner"
      className="my-4 flex items-center justify-between rounded-xl border border-notice-line bg-notice-surface p-4 text-sm text-notice-ink motion-safe:transition-all"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-notice-line text-xs font-semibold">
          i
        </span>
        <p className="font-medium">{message}</p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('shell.dismissBanner')}
        className="rounded-lg p-2 hover:bg-ink/5"
      >
        ✕
      </button>
    </div>
  )
}
