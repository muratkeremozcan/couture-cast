'use client'

import {
  defaultSupportedLocale,
  resolveSupportedLocale,
} from '@couture/api-client/contracts/http'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../../i18n'
import { SettingsHelp } from '../../components/settings-help'
import { SettingsDestination } from '../settings-destination'

export default function LanguagePage() {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const locale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  return (
    <SettingsDestination topic="language">
      <p className="font-semibold">{t(`settings.profile.languages.${locale}`)}</p>
      <SettingsHelp summary={t('settings.profile.languageHelp')}>
        <p>{t('settings.profile.browserLanguageHelp')}</p>
      </SettingsHelp>
    </SettingsDestination>
  )
}
