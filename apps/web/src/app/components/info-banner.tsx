'use client'

// Story 3.7 Task 4 step 1 owner: implement web reusable info banner for invalid deep link notifications
import React, { useState } from 'react'

export interface InfoBannerProps {
  message: string
  onDismiss?: () => void
}

export function InfoBanner({ message, onDismiss }: InfoBannerProps) {
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
      className="my-4 flex items-center justify-between rounded-xl border border-[#C9A14A]/40 bg-[#111111] p-4 text-sm text-[#FFFFFF] shadow-lg motion-safe:transition-all"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A14A]/20 text-[#C9A14A] font-semibold text-xs">
          i
        </span>
        <p className="font-medium text-[#F5F5F7]">{message}</p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss banner"
        className="rounded-lg p-1.5 text-[#F5F5F7] hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
      >
        ✕
      </button>
    </div>
  )
}
