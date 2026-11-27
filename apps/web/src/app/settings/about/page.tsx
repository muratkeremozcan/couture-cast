'use client'

import { useTranslation } from 'react-i18next'
import { getI18n } from '../../../i18n'
import { CommercePreferencesSection } from '../../components/commerce-preferences-section'
import { ScreenGate } from '../../components/screen-gate'
import { LegalLinks } from '../../components/legal-links'
import { SettingsDestination } from '../settings-destination'

const READS = ['commerce'] as const

export default function AboutPage() {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <SettingsDestination topic="about">
      <h2 className="text-lg font-semibold">CoutureCast</h2>
      <p className="mt-2 text-sm text-ink-soft">{t('settings.profile.aboutHelp')}</p>
      <LegalLinks className="mt-3" />
      <ScreenGate screen="settings-about" reads={READS}>
        <CommercePreferencesSection />
      </ScreenGate>
    </SettingsDestination>
  )
}
