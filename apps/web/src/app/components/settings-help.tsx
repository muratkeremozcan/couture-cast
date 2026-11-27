'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

export function SettingsHelp({
  summary,
  children,
}: {
  summary: string
  children: ReactNode
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <div className="mt-3 text-sm text-ink-soft [overflow-wrap:anywhere]">
      <details>
        <summary
          data-testid="settings-learn-more"
          className="min-h-touch w-fit max-w-full cursor-pointer list-none py-2 [&::-webkit-details-marker]:hidden"
        >
          {summary}{' '}
          <span className="font-medium underline">{t('settings.profile.learnMore')}</span>
        </summary>
        <div className="mb-3">{children}</div>
      </details>
    </div>
  )
}
