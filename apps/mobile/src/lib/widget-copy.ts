import type {
  SupportedLocale,
  WeatherCondition,
} from '@couture/api-client/contracts/http'
import deDE from '../../assets/locales/de-DE.json'
import enCA from '../../assets/locales/en-CA.json'
import enUS from '../../assets/locales/en-US.json'
import es419 from '../../assets/locales/es-419.json'
import frCA from '../../assets/locales/fr-CA.json'
import frFR from '../../assets/locales/fr-FR.json'
import itIT from '../../assets/locales/it-IT.json'
import ptBR from '../../assets/locales/pt-BR.json'
import ptPT from '../../assets/locales/pt-PT.json'
import trTR from '../../assets/locales/tr-TR.json'

const resources = {
  'de-DE': deDE,
  'en-CA': enCA,
  'en-US': enUS,
  'es-419': es419,
  'fr-CA': frCA,
  'fr-FR': frFR,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  'tr-TR': trTR,
} satisfies Record<SupportedLocale, typeof enUS>

export type WidgetCopy = {
  condition: string
  now: string
  nextHour: string
  stale: string
  unavailable: string
  precipitation: string
}

export function getWidgetCopy(
  locale: SupportedLocale,
  condition: WeatherCondition
): WidgetCopy {
  const resource = resources[locale]
  return {
    condition: resource.hero.conditions[condition],
    now: resource.widget.now,
    nextHour: resource.widget.next_hour,
    stale: resource.widget.stale,
    unavailable: resource.widget.unavailable,
    precipitation: resource.widget.precipitation,
  }
}
