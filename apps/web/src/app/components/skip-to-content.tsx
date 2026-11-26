// Story 3.8 Task 2 step 1 owner: implement SkipToContent link and main landmark focus target in apps/web/src/app/components/skip-to-content.tsx
'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

export function SkipToContent(): React.JSX.Element {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-inverse focus:px-4 focus:py-2 focus:font-semibold focus:text-on-inverse focus:shadow-overlay"
    >
      {t('shell.skipToContent')}
    </a>
  )
}
