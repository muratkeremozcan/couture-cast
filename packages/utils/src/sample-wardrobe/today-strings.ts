import { resolveGuestPreviewLocale } from './format'
import type { GuestPreviewLocale } from './strings'

type TodayStrings = {
  wearThis: string
  weatherReason: string
  source: string
  lookName: Record<'rain' | 'wind' | 'cool' | 'warm' | 'mild', string>
}

const english: TodayStrings = {
  wearThis: 'Wear this',
  weatherReason: 'Picked for {temperature} weather.',
  source: 'From Today',
  lookName: {
    rain: 'Rain-ready look',
    wind: 'Wind-ready look',
    cool: 'Cool-weather look',
    warm: 'Warm-weather look',
    mild: 'Mild-weather look',
  },
}

const french: TodayStrings = {
  wearThis: 'Porter cette tenue',
  weatherReason: 'Choisie pour une météo à {temperature}.',
  source: 'Depuis Aujourd’hui',
  lookName: {
    rain: 'Tenue pour la pluie',
    wind: 'Tenue pour le vent',
    cool: 'Tenue pour temps frais',
    warm: 'Tenue pour temps chaud',
    mild: 'Tenue pour temps doux',
  },
}

const strings: Record<GuestPreviewLocale, TodayStrings> = {
  'en-US': english,
  'en-CA': english,
  'de-DE': {
    wearThis: 'Dieses Outfit tragen',
    weatherReason: 'Passend für {temperature}.',
    source: 'Aus Heute',
    lookName: {
      rain: 'Outfit für Regen',
      wind: 'Outfit für Wind',
      cool: 'Outfit für kühles Wetter',
      warm: 'Outfit für warmes Wetter',
      mild: 'Outfit für mildes Wetter',
    },
  },
  'es-419': {
    wearThis: 'Usar este conjunto',
    weatherReason: 'Elegido para un clima de {temperature}.',
    source: 'De Hoy',
    lookName: {
      rain: 'Conjunto para la lluvia',
      wind: 'Conjunto para el viento',
      cool: 'Conjunto para días frescos',
      warm: 'Conjunto para días cálidos',
      mild: 'Conjunto para días templados',
    },
  },
  'fr-CA': french,
  'fr-FR': french,
  'it-IT': {
    wearThis: 'Indossa questo look',
    weatherReason: 'Scelto per una temperatura di {temperature}.',
    source: 'Da Oggi',
    lookName: {
      rain: 'Look da pioggia',
      wind: 'Look per il vento',
      cool: 'Look per giornate fresche',
      warm: 'Look per giornate calde',
      mild: 'Look per un clima mite',
    },
  },
  'pt-BR': {
    wearThis: 'Usar este look',
    weatherReason: 'Escolhido para um clima de {temperature}.',
    source: 'De Hoje',
    lookName: {
      rain: 'Look para chuva',
      wind: 'Look para vento',
      cool: 'Look para dias frescos',
      warm: 'Look para dias quentes',
      mild: 'Look para clima ameno',
    },
  },
  'pt-PT': {
    wearThis: 'Vestir este conjunto',
    weatherReason: 'Escolhido para uma temperatura de {temperature}.',
    source: 'De Hoje',
    lookName: {
      rain: 'Conjunto para a chuva',
      wind: 'Conjunto para o vento',
      cool: 'Conjunto para dias frescos',
      warm: 'Conjunto para dias quentes',
      mild: 'Conjunto para dias amenos',
    },
  },
  'tr-TR': {
    wearThis: 'Bunu giy',
    weatherReason: '{temperature} hava için seçildi.',
    source: 'Bugün’den',
    lookName: {
      rain: 'Yağmura uygun kombin',
      wind: 'Rüzgâra uygun kombin',
      cool: 'Serin havaya uygun kombin',
      warm: 'Sıcak havaya uygun kombin',
      mild: 'Ilık havaya uygun kombin',
    },
  },
}

export function getTodayOutfitStrings(locale: string): TodayStrings {
  return strings[resolveGuestPreviewLocale(locale)]
}

export function formatTodayWornOn(wornOn: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${wornOn}T00:00:00Z`))
}
