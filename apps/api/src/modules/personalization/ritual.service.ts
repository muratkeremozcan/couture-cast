// Step 22 step 3 owner: define localized comfort notes and intercept headers in apps/api/src/modules/personalization/ritual.service.ts
import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  type OnModuleDestroy,
} from '@nestjs/common'
import {
  PrismaClient,
  type OutfitRecommendation,
  type GarmentItem,
  Prisma,
} from '@prisma/client'
import Redis from 'ioredis'

export const RITUAL_REDIS_CLIENT = Symbol('RITUAL_REDIS_CLIENT')

import { WeatherQueryService } from '../weather/weather-query.service.js'
import { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import type { WeatherSnapshotWithSegments } from '../weather/weather.repository.js'
import {
  defaultSupportedLocale,
  resolveAcceptLanguage,
  resolveSupportedLocale,
  type PrecipPreparedness,
  type RitualResponse,
  type ScenarioName,
  type ScenarioOutfit,
  type SupportedLocale,
  type WeatherAlert,
  type WeatherCondition,
  type WeatherProvider,
  type WindTolerance,
} from '../../contracts/http.js'

const formattersMap = new Map<string, Intl.DateTimeFormat>()

function getHourInTimezone(date: Date, timezone: string): number {
  const key = `hour-${timezone}`
  let formatter = formattersMap.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    })
    formattersMap.set(key, formatter)
  }
  return parseInt(formatter.format(date), 10)
}

function getLocalDateString(date: Date, timezone: string): string {
  const key = `date-${timezone}`
  let formatter = formattersMap.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formattersMap.set(key, formatter)
  }
  return formatter.format(date)
}

function buildMockForecastSegmentInputs(now: Date) {
  return Array.from({ length: 48 }, (_, offset) => {
    const forecastAt = new Date(now.getTime() + offset * 60 * 60 * 1000)
    return {
      forecast_at: forecastAt,
      hour_offset: offset,
      temperature: 68.0,
      feels_like: 68.0,
      precipitation_probability: 0.0,
      precipitation_amount: 0.0,
      wind_speed: 5.0,
      wind_gust: null,
      condition: 'clear',
      provider_weather_code: 'clear',
    }
  })
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toWeatherAlerts(alerts: unknown): WeatherAlert[] {
  if (!Array.isArray(alerts)) {
    return []
  }

  const severityMap: Record<string, 'low' | 'medium' | 'high'> = {
    minor: 'low',
    low: 'low',
    moderate: 'medium',
    medium: 'medium',
    severe: 'high',
    extreme: 'high',
    high: 'high',
  }

  return alerts.map((alert): WeatherAlert => {
    const persistedAlert = alert as {
      event: string
      description: string
      start: Date | string
      end: Date | string
      severity?: string
    }

    const rawSeverity = persistedAlert.severity?.toLowerCase() ?? 'medium'
    const mappedSeverity = severityMap[rawSeverity] || 'medium'

    return {
      event: persistedAlert.event,
      description: persistedAlert.description,
      start: toIsoTimestamp(persistedAlert.start),
      end: toIsoTimestamp(persistedAlert.end),
      severity: mappedSeverity,
    }
  })
}

function toWeatherSnapshot(snapshot: WeatherSnapshotWithSegments) {
  return {
    locationKey: snapshot.location_key,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    timezone: snapshot.timezone,
    provider: snapshot.provider as WeatherProvider,
    providerUpdatedAt: snapshot.provider_updated_at.toISOString(),
    fetchedAt: snapshot.fetched_at.toISOString(),
    current: {
      temperature: snapshot.temperature,
      condition: snapshot.condition as WeatherCondition,
    },
    hourly: snapshot.segments.map((segment) => ({
      forecastAt: segment.forecast_at.toISOString(),
      temperature: segment.temperature,
      feelsLike: segment.feels_like,
      precipitationProbability: segment.precipitation_probability,
      precipitationAmount: segment.precipitation_amount,
      windSpeed: segment.wind_speed,
      windGust: segment.wind_gust,
      condition: segment.condition as WeatherCondition,
      providerWeatherCode: segment.provider_weather_code,
    })),
    alerts: toWeatherAlerts(snapshot.alerts),
  }
}

// Wind threshold limits in meters per second (m/s) based on wind tolerance setting
const WIND_THRESHOLD_M_S: Record<WindTolerance, number> = {
  low: 3, // Sensitive to wind; flag wind-blocking layer at lower speeds
  medium: 5, // Moderate tolerance
  high: 8, // High tolerance; flag only in high wind speeds
} as const

// Precipitation probability threshold (0.0 to 1.0) based on preparedness setting
const PRECIP_PROB_THRESHOLD: Record<PrecipPreparedness, number> = {
  high: 0.2, // Highly prepared/cautious; suggest outerwear/umbrella for low probability
  medium: 0.4, // Moderate caution
  low: 0.7, // Low caution; suggest only for high probability
} as const

// Precipitation amount threshold in millimeters (mm) based on preparedness setting
const PRECIP_AMOUNT_THRESHOLD_MM: Record<PrecipPreparedness, number> = {
  high: 0.1, // Cautious; suggest for very light rain
  medium: 0.5, // Moderate
  low: 2.0, // High threshold; suggest only for heavier rain
} as const

function getWindThreshold(windTolerance: WindTolerance): number {
  return WIND_THRESHOLD_M_S[windTolerance] ?? 5.0
}

function getRainProbThreshold(precipPreparedness: PrecipPreparedness): number {
  return PRECIP_PROB_THRESHOLD[precipPreparedness] ?? 0.3
}

function getRainAmountThreshold(precipPreparedness: PrecipPreparedness): number {
  return PRECIP_AMOUNT_THRESHOLD_MM[precipPreparedness] ?? 0.1
}

const BADGE_MAPPING = [
  { keyword: 'wind', key: 'wind_layer', label: 'Wind layer' },
  { keyword: 'rain', key: 'rain_ready', label: 'Rain-ready' },
  { keyword: 'evening', key: 'evening_chill', label: 'Evening chill' },
  { keyword: 'chill', key: 'evening_chill', label: 'Evening chill' },
  { keyword: 'commute', key: 'commute_warmth', label: 'Commute warmth' },
  { keyword: 'warmth', key: 'commute_warmth', label: 'Commute warmth' },
  { keyword: 'sun', key: 'sun_protection', label: 'Sun protection' },
  { keyword: 'protection', key: 'sun_protection', label: 'Sun protection' },
  { keyword: 'light', key: 'light_layers', label: 'Light layers' },
  { keyword: 'layer', key: 'light_layers', label: 'Light layers' },
  { keyword: 'breathable', key: 'breathable_comfort', label: 'Breathable comfort' },
  { keyword: 'comfort', key: 'breathable_comfort', label: 'Breathable comfort' },
] as const

interface ComfortNotesDict {
  feels_like_adjusted: string
  feels_like_neutral: string
  cold: string
  chilly: string
  mild: string
  warm: string
  hot: string
  windy: string
  rainy: string
}

export const comfortNotesTranslations: Record<SupportedLocale, ComfortNotesDict> = {
  'en-US': {
    feels_like_adjusted:
      'Feels like {feelsLike}°F (adjusted to {adjustedFeelsLike}°F for comfort).',
    feels_like_neutral: 'Feels like {feelsLike}°F (neutral preference).',
    cold: 'It is cold, so a heavy coat or extra warmth is recommended.',
    chilly: 'Chilly conditions today; outerwear is recommended.',
    mild: 'Mild and pleasant day; light layers will keep you comfortable.',
    warm: 'Warm day; a standard top and bottom or dress is perfect.',
    hot: 'Hot weather; light, breathable garments are best.',
    windy: 'Winds are high at {windSpeed} m/s, so we suggest a wind-blocking layer.',
    rainy:
      'Rain is likely. We recommend bringing an umbrella or rain-resistant outerwear.',
  },
  'en-CA': {
    feels_like_adjusted:
      'Feels like {feelsLike}°C (adjusted to {adjustedFeelsLike}°C for comfort).',
    feels_like_neutral: 'Feels like {feelsLike}°C (neutral preference).',
    cold: 'It is cold, so a heavy coat or extra warmth is recommended.',
    chilly: 'Chilly conditions today; outerwear is recommended.',
    mild: 'Mild and pleasant day; light layers will keep you comfortable.',
    warm: 'Warm day; a standard top and bottom or dress is perfect.',
    hot: 'Hot weather; light, breathable garments are best.',
    windy: 'Winds are high at {windSpeed} m/s, so we suggest a wind-blocking layer.',
    rainy:
      'Rain is likely. We recommend bringing an umbrella or rain-resistant outerwear.',
  },
  'es-419': {
    feels_like_adjusted:
      'Sensación térmica {feelsLike}°C (ajustado a {adjustedFeelsLike}°C para tu comodidad).',
    feels_like_neutral: 'Sensación térmica {feelsLike}°C (preferencia neutra).',
    cold: 'Hace frío, por lo que se recomienda un abrigo pesado o abrigo extra.',
    chilly: 'Condiciones frescas hoy; se recomienda ropa de abrigo.',
    mild: 'Día templado y agradable; capas ligeras te mantendrán cómodo.',
    warm: 'Día cálido; una blusa/camisa estándar y pantalón o un vestido es perfecto.',
    hot: 'Clima caluroso; las prendas ligeras y transpirables son las mejores.',
    windy:
      'Los vientos son fuertes a {windSpeed} m/s, por lo que sugerimos una capa cortavientos.',
    rainy:
      'Es probable que llueva. Recomendamos llevar paraguas o ropa exterior resistente a la lluvia.',
  },
  'fr-CA': {
    feels_like_adjusted:
      'Température ressentie de {feelsLike}°C (ajustée à {adjustedFeelsLike}°C pour votre confort).',
    feels_like_neutral: 'Température ressentie de {feelsLike}°C (préférence neutre).',
    cold: 'Il fait froid, un manteau chaud ou des épaisseurs supplémentaires sont recommandés.',
    chilly: 'Conditions fraîches aujourd’hui; un vêtement d’extérieur est recommandé.',
    mild: 'Journée douce et agréable; des vêtements légers vous garderont à l’aise.',
    warm: 'Journée chaude; un haut et un bas standard ou une robe conviennent parfaitement.',
    hot: 'Temps chaud; des vêtements légers et respirants sont préférables.',
    windy:
      'Les vents sont forts à {windSpeed} m/s, nous suggérons donc une couche coupe-vent.',
    rainy:
      'De la pluie est probable. Nous vous conseillons d’apporter un parapluie ou un vêtement imperméable.',
  },
  'fr-FR': {
    feels_like_adjusted:
      'Température ressentie de {feelsLike}°C (ajustée à {adjustedFeelsLike}°C pour votre confort).',
    feels_like_neutral: 'Température ressentie de {feelsLike}°C (préférence neutre).',
    cold: 'Il fait froid, un manteau chaud ou des épaisseurs supplémentaires sont recommandés.',
    chilly: 'Conditions fraîches aujourd’hui; un vêtement d’extérieur est recommandé.',
    mild: 'Journée douce et agréable; des vêtements légers vous garderont à l’aise.',
    warm: 'Journée chaude; un haut et un bas standard ou une robe conviennent parfaitement.',
    hot: 'Temps chaud; des vêtements légers et respirants sont préférables.',
    windy:
      'Les vents sont forts à {windSpeed} m/s, nous suggérons donc une couche coupe-vent.',
    rainy:
      'De la pluie est probable. Nous vous conseillons d’apporter un parapluie ou un vêtement imperméable.',
  },
  'tr-TR': {
    feels_like_adjusted:
      'Hissedilen sıcaklık {feelsLike}°C (konfor için {adjustedFeelsLike}°C ayarlandı).',
    feels_like_neutral: 'Hissedilen sıcaklık {feelsLike}°C (nötr tercih).',
    cold: 'Hava soğuk, bu nedenle kalın bir mont veya ekstra giysi önerilir.',
    chilly: 'Bugün hava serin; dış giyim önerilir.',
    mild: 'Ilık ve hoş bir gün; hafif katmanlar sizi rahat ettirecektir.',
    warm: 'Sıcak bir gün; standart bir üst ve alt veya elbise mükemmeldir.',
    hot: 'Sıcak hava; hafif, nefes alabilen giysiler en iyisidir.',
    windy: 'Rüzgar hızı {windSpeed} m/s ile yüksek, rüzgar kesici bir katman öneriyoruz.',
    rainy:
      'Yağmur olasıdır. Şemsiye veya yağmura dayanıklı dış giyim getirmenizi öneririz.',
  },
  'de-DE': {
    feels_like_adjusted:
      'Gefühlt wie {feelsLike}°C (für Komfort auf {adjustedFeelsLike}°C angepasst).',
    feels_like_neutral: 'Gefühlt wie {feelsLike}°C (neutrale Präferenz).',
    cold: 'Es ist kalt, daher wird ein schwerer Mantel oder zusätzliche Wärme empfohlen.',
    chilly: 'Kühle Bedingungen heute; Oberbekleidung wird empfohlen.',
    mild: 'Milder und angenehmer Tag; leichte Schichten halten Sie bequem.',
    warm: 'Warmer Tag; ein Standard-Oberteil und -Unterteil oder ein Kleid ist perfekt.',
    hot: 'Heißes Wetter; leichte, atmungsaktive Kleidungsstücke sind am besten.',
    windy:
      'Die Winde sind hoch bei {windSpeed} m/s, daher empfehlen wir eine windabweisende Schicht.',
    rainy:
      'Regen ist wahrscheinlich. Wir empfehlen einen Regenschirm oder regenbeständige Oberbekleidung.',
  },
  'it-IT': {
    feels_like_adjusted:
      'Percepito {feelsLike}°C (adattato a {adjustedFeelsLike}°C per il comfort).',
    feels_like_neutral: 'Percepito {feelsLike}°C (preferenza neutrale).',
    cold: 'Fa freddo, quindi si consiglia un cappotto pesante o calore extra.',
    chilly: 'Condizioni fresche oggi; si consiglia un capospalla.',
    mild: 'Giornata mite e piacevole; strati leggeri ti terranno comodo.',
    warm: 'Giornata calda; un top e un fondo standard o un vestito sono perfetti.',
    hot: 'Tempo caldo; i capi leggeri e traspiranti sono i migliori.',
    windy:
      'I venti sono forti a {windSpeed} m/s, quindi suggeriamo uno strato antivento.',
    rainy:
      'È probabile che piova. Si consiglia di portare un ombrello o un capospalla resistente alla pioggia.',
  },
  'pt-BR': {
    feels_like_adjusted:
      'Sensação térmica de {feelsLike}°C (ajustada para {adjustedFeelsLike}°C para seu conforto).',
    feels_like_neutral: 'Sensação térmica de {feelsLike}°C (preferência neutra).',
    cold: 'Está frio, por isso recomenda-se um casaco pesado ou agasalho extra.',
    chilly: 'Condições amenas/frias hoje; recomenda-se um casaco leve.',
    mild: 'Dia ameno e agradável; roupas leves em camadas vão manter você confortável.',
    warm: 'Dia quente; camiseta e calça padrão ou um vestido são perfeitos.',
    hot: 'Clima quente; roupas leves e respiráveis são as melhores.',
    windy: 'Vento forte de {windSpeed} m/s, sugerimos uma camada corta-vento.',
    rainy:
      'Chance de chuva. Recomendamos levar um guarda-chuva ou usar um casaco impermeável.',
  },
  'pt-PT': {
    feels_like_adjusted:
      'Sensação térmica de {feelsLike}°C (ajustada para {adjustedFeelsLike}°C para o seu conforto).',
    feels_like_neutral: 'Sensação térmica de {feelsLike}°C (preferência neutra).',
    cold: 'Está frio, pelo que se recomenda um casaco pesado ou agasalho extra.',
    chilly: 'Condições amenas/frias hoje; recomenda-se um casaco leve.',
    mild: 'Dia ameno e agradável; roupas leves em camadas vão mantê-lo confortável.',
    warm: 'Dia quente; camisola e calças padrão ou um vestido são perfeitos.',
    hot: 'Clima quente; roupas leves e respiráveis são as melhores.',
    windy: 'Vento forte de {windSpeed} m/s, sugerimos uma camada corta-vento.',
    rainy:
      'Chance de chuva. Recomendamos levar um guarda-chuva ou usar um casaco impermeável.',
  },
}

export const badgeTranslations: Record<
  SupportedLocale,
  Record<string, { label: string; bullets: string[] }>
> = {
  'en-US': {
    wind_layer: {
      label: 'Wind layer',
      bullets: ['Suggest a wind-blocking layer because winds are high'],
    },
    rain_ready: {
      label: 'Rain-ready',
      bullets: ['Recommend rain-resistant outerwear or bringing an umbrella'],
    },
    evening_chill: {
      label: 'Evening chill',
      bullets: ['Wear warm layers as temperature drops in the evening'],
    },
    commute_warmth: {
      label: 'Commute warmth',
      bullets: ['Extra layers suggested for cooler morning commute'],
    },
    sun_protection: {
      label: 'Sun protection',
      bullets: ['Light-colored and UV-protective elements recommended'],
    },
    light_layers: {
      label: 'Light layers',
      bullets: ['Light layers are sufficient for mild and pleasant day'],
    },
    breathable_comfort: {
      label: 'Breathable comfort',
      bullets: ['Breathable garments recommended for hot conditions'],
    },
    daily_base: {
      label: 'Daily base',
      bullets: ['Standard top and bottom suitable for the day'],
    },
  },
  'en-CA': {
    wind_layer: {
      label: 'Wind layer',
      bullets: ['Suggest a wind-blocking layer because winds are high'],
    },
    rain_ready: {
      label: 'Rain-ready',
      bullets: ['Recommend rain-resistant outerwear or bringing an umbrella'],
    },
    evening_chill: {
      label: 'Evening chill',
      bullets: ['Wear warm layers as temperature drops in the evening'],
    },
    commute_warmth: {
      label: 'Commute warmth',
      bullets: ['Extra layers suggested for cooler morning commute'],
    },
    sun_protection: {
      label: 'Sun protection',
      bullets: ['Light-colored and UV-protective elements recommended'],
    },
    light_layers: {
      label: 'Light layers',
      bullets: ['Light layers are sufficient for mild and pleasant day'],
    },
    breathable_comfort: {
      label: 'Breathable comfort',
      bullets: ['Breathable garments recommended for hot conditions'],
    },
    daily_base: {
      label: 'Daily base',
      bullets: ['Standard top and bottom suitable for the day'],
    },
  },
  'es-419': {
    wind_layer: {
      label: 'Cortaviento',
      bullets: ['Se sugiere una capa cortavientos debido a los fuertes vientos'],
    },
    rain_ready: {
      label: 'Para lluvia',
      bullets: [
        'Se recomienda ropa exterior resistente a la lluvia o llevar un paraguas',
      ],
    },
    evening_chill: {
      label: 'Fresco nocturno',
      bullets: ['Usa capas abrigadas ya que la temperatura baja por la tarde/noche'],
    },
    commute_warmth: {
      label: 'Viaje abrigado',
      bullets: ['Capas extra recomendadas para el viaje matutino fresco'],
    },
    sun_protection: {
      label: 'Protección solar',
      bullets: ['Se recomiendan prendas de colores claros y protección UV'],
    },
    light_layers: {
      label: 'Capas ligeras',
      bullets: ['Capas ligeras son suficientes para un día templado y agradable'],
    },
    breathable_comfort: {
      label: 'Comodidad transpirable',
      bullets: ['Prendas transpirables recomendadas para condiciones calurosas'],
    },
    daily_base: {
      label: 'Base diaria',
      bullets: ['Prenda superior e inferior estándar adecuadas para el día'],
    },
  },
  'fr-CA': {
    wind_layer: {
      label: 'Coupe-vent',
      bullets: ['Suggérer une couche coupe-vent en raison des vents forts'],
    },
    rain_ready: {
      label: 'Prêt pour la pluie',
      bullets: ['Recommander un vêtement imperméable ou d’apporter un parapluie'],
    },
    evening_chill: {
      label: 'Fraîcheur du soir',
      bullets: ['Porter des couches chaudes car la température baisse en soirée'],
    },
    commute_warmth: {
      label: 'Chaleur matinale',
      bullets: ['Épaisseurs supplémentaires suggérées pour le trajet frais du matin'],
    },
    sun_protection: {
      label: 'Protection solaire',
      bullets: ['Vêtements clairs et protection UV recommandés'],
    },
    light_layers: {
      label: 'Couches légères',
      bullets: ['Des couches légères suffisent pour une journée douce et agréable'],
    },
    breathable_comfort: {
      label: 'Confort respirant',
      bullets: ['Vêtements respirants recommandés pour les temps chauds'],
    },
    daily_base: {
      label: 'Base quotidienne',
      bullets: ['Haut et bas standard adaptés pour la journée'],
    },
  },
  'fr-FR': {
    wind_layer: {
      label: 'Coupe-vent',
      bullets: ['Suggérer une couche coupe-vent en raison des vents forts'],
    },
    rain_ready: {
      label: 'Prêt pour la pluie',
      bullets: ['Recommander un vêtement imperméable ou d’apporter un parapluie'],
    },
    evening_chill: {
      label: 'Fraîcheur du soir',
      bullets: ['Porter des couches chaudes car la température baisse en soirée'],
    },
    commute_warmth: {
      label: 'Chaleur matinale',
      bullets: ['Épaisseurs supplémentaires suggérées pour le trajet frais du matin'],
    },
    sun_protection: {
      label: 'Protection solaire',
      bullets: ['Vêtements clairs et protection UV recommandés'],
    },
    light_layers: {
      label: 'Couches légères',
      bullets: ['Des couches légères suffisent pour une journée douce et agréable'],
    },
    breathable_comfort: {
      label: 'Confort respirant',
      bullets: ['Vêtements respirants recommandés pour les temps chauds'],
    },
    daily_base: {
      label: 'Base quotidienne',
      bullets: ['Haut et bas standard adaptés pour la journée'],
    },
  },
  'tr-TR': {
    wind_layer: {
      label: 'Rüzgarlık',
      bullets: ['Yüksek rüzgar nedeniyle rüzgar kesici bir katman önerilir'],
    },
    rain_ready: {
      label: 'Yağmura hazırlık',
      bullets: ['Şemsiye getirilmesi veya yağmura dayanıklı dış giyim önerilir'],
    },
    evening_chill: {
      label: 'Akşam serinliği',
      bullets: ['Akşam sıcaklık düştüğü için sıcak katmanlar giyin'],
    },
    commute_warmth: {
      label: 'Sabah yolculuğu',
      bullets: ['Serin sabah yolculuğu için ekstra katmanlar önerilir'],
    },
    sun_protection: {
      label: 'Güneş koruması',
      bullets: ['Açık renkli ve UV korumalı kıyafetler önerilir'],
    },
    light_layers: {
      label: 'Hafif katmanlar',
      bullets: ['Ilık ve hoş bir gün için hafif katmanlar yeterlidir'],
    },
    breathable_comfort: {
      label: 'Nefes alabilir konfor',
      bullets: ['Sıcak koşullar için nefes alabilir giysiler önerilir'],
    },
    daily_base: {
      label: 'Günlük temel',
      bullets: ['Gün için uygun standart üst ve alt giysi'],
    },
  },
  'de-DE': {
    wind_layer: {
      label: 'Windschutz',
      bullets: ['Empfehlen Sie eine windabweisende Schicht, da die Winde stark sind'],
    },
    rain_ready: {
      label: 'Regenfest',
      bullets: ['Regenbeständige Oberbekleidung oder Regenschirm empfohlen'],
    },
    evening_chill: {
      label: 'Abendkühle',
      bullets: ['Tragen Sie warme Schichten, wenn die Temperaturen am Abend sinken'],
    },
    commute_warmth: {
      label: 'Pendlerwärme',
      bullets: ['Zusätzliche Schichten für den kühleren Morgenpendelverkehr empfohlen'],
    },
    sun_protection: {
      label: 'Sonnenschutz',
      bullets: ['Helle und UV-schützende Kleidungsstücke empfohlen'],
    },
    light_layers: {
      label: 'Leichte Schichten',
      bullets: ['Leichte Schichten reichen für einen milden und angenehmen Tag aus'],
    },
    breathable_comfort: {
      label: 'Atmungsaktiver Komfort',
      bullets: ['Atmungsaktive Kleidungsstücke für heiße Bedingungen empfohlen'],
    },
    daily_base: {
      label: 'Tägliche Basis',
      bullets: ['Standard-Oberteil und -Unterteil für den Tag geeignet'],
    },
  },
  'it-IT': {
    wind_layer: {
      label: 'Strato antivento',
      bullets: ['Suggerisci uno strato antivento poiché i venti sono forti'],
    },
    rain_ready: {
      label: 'Pronto per la pioggia',
      bullets: ['Consiglia capispalla resistenti alla pioggia o ombrello'],
    },
    evening_chill: {
      label: 'Fresco serale',
      bullets: ['Indossa strati caldi poiché la temperatura scende in serata'],
    },
    commute_warmth: {
      label: 'Calore per il viaggio',
      bullets: ['Strati extra consigliati per il pendolarismo mattutino più fresco'],
    },
    sun_protection: {
      label: 'Protezione solare',
      bullets: ['Consigliati capi chiari e protettivi dai raggi UV'],
    },
    light_layers: {
      label: 'Strati leggeri',
      bullets: ['Gli strati leggeri sono sufficienti per una giornata mite e piacevole'],
    },
    breathable_comfort: {
      label: 'Comfort traspirante',
      bullets: ['Consigliati capi traspiranti per le condizioni calde'],
    },
    daily_base: {
      label: 'Base quotidiana',
      bullets: ['Top e fondo standard adatti alla giornata'],
    },
  },
  'pt-BR': {
    wind_layer: {
      label: 'Corta-vento',
      bullets: ['Recomenda-se um casaco corta-vento porque os ventos estão fortes'],
    },
    rain_ready: {
      label: 'Pronto para chuva',
      bullets: ['Recomenda-se casaco impermeável ou guarda-chuva'],
    },
    evening_chill: {
      label: 'Frio da noite',
      bullets: ['Use casaco ou camadas quentes, pois a temperatura cai à noite'],
    },
    commute_warmth: {
      label: 'Caminho aquecido',
      bullets: ['Camadas extras sugeridas para o caminho frio da manhã'],
    },
    sun_protection: {
      label: 'Proteção solar',
      bullets: ['Recomenda-se roupas de cores claras e proteção UV'],
    },
    light_layers: {
      label: 'Camadas leves',
      bullets: ['Camadas leves são suficientes para um dia ameno e agradável'],
    },
    breathable_comfort: {
      label: 'Conforto respirável',
      bullets: ['Recomenda-se roupas respiráveis para o clima quente'],
    },
    daily_base: {
      label: 'Base diária',
      bullets: ['Camiseta e calça padrão adequados para o dia'],
    },
  },
  'pt-PT': {
    wind_layer: {
      label: 'Corta-vento',
      bullets: ['Recomenda-se um casaco corta-vento porque os ventos estão fortes'],
    },
    rain_ready: {
      label: 'Pronto para a chuva',
      bullets: ['Recomenda-se casaco impermeável ou guarda-chuva'],
    },
    evening_chill: {
      label: 'Frio da noite',
      bullets: ['Use casaco ou camadas quentes, pois a temperatura cai à noite'],
    },
    commute_warmth: {
      label: 'Percurso aquecido',
      bullets: ['Camadas extras sugeridas para o percurso frio da manhã'],
    },
    sun_protection: {
      label: 'Proteção solar',
      bullets: ['Recomenda-se roupas de cores claras e proteção UV'],
    },
    light_layers: {
      label: 'Camadas leves',
      bullets: ['Camadas leves são suficientes para um dia ameno e agradável'],
    },
    breathable_comfort: {
      label: 'Conforto respirável',
      bullets: ['Recomenda-se roupas respiráveis para o clima quente'],
    },
    daily_base: {
      label: 'Base diária',
      bullets: ['Camisola e calças padrão adequadas para o dia'],
    },
  },
}

type RawReasoningBadge = {
  key?: string
  label?: string
  bullets?: string[]
}

function validBadgeBullets(bullets: unknown): string[] {
  return Array.isArray(bullets)
    ? bullets.filter((bullet): bullet is string => typeof bullet === 'string')
    : []
}

function resolveCanonicalBadgeKey(badge: RawReasoningBadge): string | undefined {
  if (badge.key) {
    return badge.key in badgeTranslations['en-US'] ? badge.key : undefined
  }

  const normalizedLabel = (badge.label ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return BADGE_MAPPING.find((item) => normalizedLabel.includes(item.keyword))?.key
}

function preserveCustomBadge(badge: RawReasoningBadge) {
  const key = badge.key ?? 'daily_base'
  const label = badge.label ?? badge.key ?? 'Daily base'
  const bullets = validBadgeBullets(badge.bullets)
  return { key, label, bullets: bullets.length > 0 ? bullets : [label] }
}

function mapRawBadgeToCanonical(
  badge: RawReasoningBadge,
  locale: SupportedLocale = defaultSupportedLocale
): { key: string; label: string; bullets: string[] } {
  const key = resolveCanonicalBadgeKey(badge)
  if (!key) {
    return preserveCustomBadge(badge)
  }

  const localized = badgeTranslations[locale][key]
  const sourceBullets = validBadgeBullets(badge.bullets)
  const shouldLocalizeBullets = locale !== 'en-US' && locale !== 'en-CA'
  const bullets =
    shouldLocalizeBullets && localized?.bullets.length
      ? localized.bullets
      : sourceBullets.length > 0
        ? sourceBullets
        : (localized?.bullets ?? [])

  return {
    key,
    label: localized?.label ?? badge.label ?? badge.key ?? 'Daily base',
    bullets,
  }
}

@Injectable()
export class RitualService implements OnModuleDestroy {
  private readonly logger = new Logger(RitualService.name)

  constructor(
    @Inject(PrismaClient)
    private readonly prisma: PrismaClient,
    @Inject(WeatherQueryService)
    private readonly weatherQueryService: WeatherQueryService,
    @Inject(LocationPreferencesService)
    private readonly locationPreferencesService: LocationPreferencesService,
    @Inject(RITUAL_REDIS_CLIENT)
    private readonly redis: Redis
  ) {}

  // Refreshes a snapshot's forecast segments to a contiguous 48h window anchored to `now`,
  // guaranteeing a day with morning/midday/evening coverage even when existing data is stale.
  private async upsertMockForecastSegments(snapshotId: string, now: Date): Promise<void> {
    await Promise.all(
      buildMockForecastSegmentInputs(now).map((segment, offset) =>
        this.prisma.forecastSegment.upsert({
          where: { id: `${snapshotId}-seg-${offset}` },
          update: segment,
          create: {
            id: `${snapshotId}-seg-${offset}`,
            weather_snapshot_id: snapshotId,
            ...segment,
          },
        })
      )
    )
  }

  // eslint-disable-next-line complexity
  async getOrCreateRitual(
    userId: string,
    locationId?: string,
    acceptLanguage?: string,
    localeOverride?: SupportedLocale
  ): Promise<RitualResponse['data']> {
    // 1. Resolve Location
    const locations = await this.locationPreferencesService.listLocations(userId)
    let selectedLocation = locations.find((l) => l.id === locationId)

    if (locationId && !selectedLocation) {
      throw new BadRequestException('Location preferences not found or not owned by user')
    }

    if (!selectedLocation) {
      selectedLocation = locations.find((l) => l.isPrimary) ?? locations[0]
    }

    if (!selectedLocation) {
      throw new BadRequestException('No location preferences found for user')
    }

    const isTestEnv =
      process.env.TEST_ENV === 'local' ||
      process.env.TEST_ENV === 'preview' ||
      process.env.VERCEL_ENV === 'preview'

    // 2. Load Comfort Preferences, User Profile, and Weather Snapshot
    const [comfortPrefs, userProfile, weatherResult] = await Promise.all([
      this.prisma.comfortPreferences.findUnique({ where: { user_id: userId } }),
      this.prisma.userProfile.findUnique({ where: { user_id: userId } }),
      this.weatherQueryService.getLatestWeather(selectedLocation.locationKey),
    ])

    const savedLocaleCandidate =
      userProfile?.preferences &&
      typeof userProfile.preferences === 'object' &&
      !Array.isArray(userProfile.preferences) &&
      'locale' in userProfile.preferences &&
      typeof userProfile.preferences.locale === 'string'
        ? userProfile.preferences.locale
        : undefined
    const savedLocale = resolveSupportedLocale(savedLocaleCandidate)
    const locale =
      localeOverride ??
      savedLocale ??
      resolveAcceptLanguage(acceptLanguage) ??
      defaultSupportedLocale

    let weatherSnapshot = weatherResult.data

    if (weatherResult.status === 'unavailable' || !weatherResult.data) {
      if (isTestEnv) {
        const now = new Date()
        const providerUpdatedAt = new Date(now.getTime() - 30 * 60 * 1000)
        const timezone = selectedLocation.timezone || 'UTC'

        let snapshot = await this.prisma.weatherSnapshot.findFirst({
          where: { location_key: selectedLocation.locationKey },
          include: { segments: true },
        })

        if (!snapshot) {
          const snapshotId = `mock-wx-${selectedLocation.locationKey}`
          snapshot = await this.prisma.weatherSnapshot.create({
            data: {
              id: snapshotId,
              location: selectedLocation.city || selectedLocation.label || 'Unknown',
              location_key: selectedLocation.locationKey,
              latitude: selectedLocation.latitude ?? 0.0,
              longitude: selectedLocation.longitude ?? 0.0,
              timezone,
              provider: 'mock-provider',
              provider_updated_at: providerUpdatedAt,
              temperature: 68.0,
              condition: 'clear',
              fetched_at: now,
              segments: {
                create: buildMockForecastSegmentInputs(now).map((segment, offset) => ({
                  id: `${snapshotId}-seg-${offset}`,
                  ...segment,
                })),
              },
            },
            include: { segments: true },
          })
        }

        weatherSnapshot = snapshot
      } else {
        throw new InternalServerErrorException(
          weatherResult.message || 'Weather data is temporarily unavailable.'
        )
      }
    }

    if (!weatherSnapshot) {
      throw new InternalServerErrorException(
        weatherResult.message || 'Weather data is temporarily unavailable.'
      )
    }

    const timezone = weatherSnapshot.timezone

    const runsColdWarm = comfortPrefs?.runs_cold_warm ?? 'neutral'
    const windTolerance = comfortPrefs?.wind_tolerance ?? 'medium'
    const precipPreparedness = comfortPrefs?.precip_preparedness ?? 'medium'
    const comfortUpdatedAt = comfortPrefs?.updated_at ?? new Date(0)

    // Determine target date and hour
    const now = new Date()
    const currentLocalHour = getHourInTimezone(now, timezone)
    let targetTime = now.getTime()
    if (currentLocalHour >= 8) {
      targetTime += 24 * 60 * 60 * 1000
    }
    let targetLocalDateStr = getLocalDateString(new Date(targetTime), timezone)
    const originalTargetLocalDateStr = targetLocalDateStr

    // Get latest garment update timestamp for staleness check
    let latestGarment: GarmentItem | null = null
    if (this.prisma.garmentItem.findFirst) {
      latestGarment = await this.prisma.garmentItem.findFirst({
        where: { user_id: userId },
        orderBy: { updated_at: 'desc' },
      })
    }
    const wardrobeUpdatedAt = latestGarment?.updated_at ?? new Date(0)
    const stalenessThreshold = new Date(
      Math.max(comfortUpdatedAt.getTime(), wardrobeUpdatedAt.getTime())
    )

    // 3. Check Redis Cache using target date in cache key
    const cacheKey = `ritual:${userId}:${selectedLocation.locationKey}:${targetLocalDateStr}:${locale}`
    let cachedString: string | null = null
    try {
      cachedString = await this.redis.get(cacheKey)
    } catch (err) {
      console.warn('Redis cache get failed:', err instanceof Error ? err.message : err)
    }

    if (cachedString) {
      try {
        const cachedPayload = JSON.parse(cachedString) as {
          weather: { fetchedAt: string }
          generatedAt: string
          data: RitualResponse['data']
        }
        const cachedFetchedAt = cachedPayload.weather.fetchedAt
        const cachedGeneratedAt = new Date(cachedPayload.generatedAt)

        if (
          cachedFetchedAt === weatherSnapshot.fetched_at.toISOString() &&
          cachedGeneratedAt.getTime() >= stalenessThreshold.getTime()
        ) {
          return cachedPayload.data
        }
      } catch {
        // Fallback to recalculation on parse failure
      }
    }

    // 4. Find timezone-aligned forecast segments for a single target date
    const segments = weatherSnapshot.segments
    let morningSegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 8
    )
    let middaySegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 13
    )
    let eveningSegment = segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 19
    )

    // Fallback: If segments for targetLocalDateStr are not found (e.g. database seed/data is stale),
    // fall back to using the latest date present in the segments array.
    if ((!morningSegment || !middaySegment || !eveningSegment) && segments.length > 0) {
      const segmentDates = segments.map((s) =>
        getLocalDateString(s.forecast_at, timezone)
      )
      const uniqueDates = [...new Set(segmentDates)]
      for (const fallbackDate of uniqueDates.reverse()) {
        const fallbackMorning = segments.find(
          (s) =>
            getLocalDateString(s.forecast_at, timezone) === fallbackDate &&
            getHourInTimezone(s.forecast_at, timezone) === 8
        )
        const fallbackMidday = segments.find(
          (s) =>
            getLocalDateString(s.forecast_at, timezone) === fallbackDate &&
            getHourInTimezone(s.forecast_at, timezone) === 13
        )
        const fallbackEvening = segments.find(
          (s) =>
            getLocalDateString(s.forecast_at, timezone) === fallbackDate &&
            getHourInTimezone(s.forecast_at, timezone) === 19
        )
        if (fallbackMorning && fallbackMidday && fallbackEvening) {
          morningSegment = fallbackMorning
          middaySegment = fallbackMidday
          eveningSegment = fallbackEvening
          targetLocalDateStr = fallbackDate
          break
        }
      }
    }

    // Self-heal: existing segments have no date with full morning/midday/evening coverage
    // (e.g. stale staging seed data). Refresh a contiguous 48h window anchored to now
    // rather than surfacing a 500 for a condition the app can recover from.
    if ((!morningSegment || !middaySegment || !eveningSegment) && isTestEnv) {
      await this.upsertMockForecastSegments(weatherSnapshot.id, new Date())
      const refreshedSnapshot = await this.prisma.weatherSnapshot.findUniqueOrThrow({
        where: { id: weatherSnapshot.id },
        include: { segments: true },
      })
      weatherSnapshot = refreshedSnapshot
      targetLocalDateStr = originalTargetLocalDateStr
      morningSegment = refreshedSnapshot.segments.find(
        (s) =>
          getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
          getHourInTimezone(s.forecast_at, timezone) === 8
      )
      middaySegment = refreshedSnapshot.segments.find(
        (s) =>
          getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
          getHourInTimezone(s.forecast_at, timezone) === 13
      )
      eveningSegment = refreshedSnapshot.segments.find(
        (s) =>
          getLocalDateString(s.forecast_at, timezone) === targetLocalDateStr &&
          getHourInTimezone(s.forecast_at, timezone) === 19
      )
    }

    if (!morningSegment || !middaySegment || !eveningSegment) {
      throw new InternalServerErrorException(
        'Required daily scenario forecast segments (morning, midday, evening) not found in weather snapshot.'
      )
    }

    const targetScenarios: { scenario: ScenarioName; segment: typeof morningSegment }[] =
      [
        { scenario: 'morning', segment: morningSegment },
        { scenario: 'midday', segment: middaySegment },
        { scenario: 'evening', segment: eveningSegment },
      ]

    // 5. Query user garments
    const userGarments = await this.prisma.garmentItem.findMany({
      where: { user_id: userId },
    })

    // 6. Build or retrieve outfit recommendations
    const outfits: ScenarioOutfit[] = []
    for (const { scenario, segment } of targetScenarios) {
      let recommendation: OutfitRecommendation | null =
        await this.prisma.outfitRecommendation.findFirst({
          where: {
            user_id: userId,
            forecast_segment_id: segment.id,
            scenario,
          },
        })

      const isStale =
        recommendation &&
        recommendation.created_at.getTime() < stalenessThreshold.getTime()

      if (!recommendation || isStale) {
        // Generate recommendation
        let adjustedFeelsLike = segment.feels_like
        if (runsColdWarm === 'cold') {
          adjustedFeelsLike -= 3
        } else if (runsColdWarm === 'warm') {
          adjustedFeelsLike += 3
        }

        // Category matching rules
        let requiredCategories: string[] = []
        if (adjustedFeelsLike < 15) {
          requiredCategories = ['outerwear', 'top', 'bottom', 'shoes']
        } else {
          // If dress is available in user closet, use dress + shoes, otherwise top + bottom + shoes
          const hasDress = userGarments.some((g) => g.category === 'dress')
          if (hasDress) {
            requiredCategories = ['dress', 'shoes']
          } else {
            requiredCategories = ['top', 'bottom', 'shoes']
          }
        }

        // Comfort range matching
        let targetComfortRange = 'mild'
        if (adjustedFeelsLike < 10) {
          targetComfortRange = 'cold'
        } else if (adjustedFeelsLike < 15) {
          targetComfortRange = 'cool'
        } else if (adjustedFeelsLike < 20) {
          targetComfortRange = 'mild'
        } else if (adjustedFeelsLike < 25) {
          targetComfortRange = 'warm'
        } else {
          targetComfortRange = 'hot'
        }

        // Choose garments
        const garmentIds = requiredCategories.map((category) => {
          const candidates = userGarments.filter((g) => g.category === category)
          if (candidates.length === 0) {
            return `default-${category}`
          }

          // Exact match
          const exact = candidates.find((g) => g.comfort_range === targetComfortRange)
          if (exact) return exact.id

          // Close matches
          const closeMatches: Record<string, string[]> = {
            cold: ['cool'],
            cool: ['mild', 'cold'],
            mild: ['cool', 'warm'],
            warm: ['mild', 'hot'],
            hot: ['warm'],
          }
          const preferences = closeMatches[targetComfortRange] || []
          for (const pref of preferences) {
            const match = candidates.find((g) => g.comfort_range === pref)
            if (match) return match.id
          }

          return candidates[0]!.id
        })

        // Rounded values for consistent trigger logic and display formatting
        const roundedAdjustedFeelsLike = Math.round(adjustedFeelsLike)

        const getFeelsLikeDesc = (raw: number, adjusted: number) => {
          const roundedRaw = Math.round(raw)
          const roundedAdj = Math.round(adjusted)
          if (roundedRaw === roundedAdj) {
            return `${roundedRaw}°C`
          }
          return `${roundedRaw}°C (adjusted to ${roundedAdj}°C)`
        }

        // Reasoning badges
        // Story 2.3 Task 2 step 1 owner: refactor dynamic badge generation and interpolation
        const badgesList: { key: string; label: string; bullets: string[] }[] = []

        // Wind tolerance trigger
        const windThreshold = getWindThreshold(windTolerance)
        if (segment.wind_speed > windThreshold) {
          const windSpeedFormatted = Math.round(segment.wind_speed * 10) / 10
          badgesList.push({
            key: 'wind_layer',
            label: 'Wind layer',
            bullets: [
              `Wind speed is ${windSpeedFormatted} m/s, which exceeds your wind tolerance threshold of ${windThreshold} m/s.`,
            ],
          })
        }

        // Rain preparation trigger
        const rainProbThreshold = getRainProbThreshold(precipPreparedness)
        const rainAmountThreshold = getRainAmountThreshold(precipPreparedness)
        const roundedProb = Math.round(segment.precipitation_probability * 100)
        const roundedProbThreshold = Math.round(rainProbThreshold * 100)
        const roundedAmount = Math.round(segment.precipitation_amount * 10) / 10
        const roundedAmountThreshold = Math.round(rainAmountThreshold * 10) / 10

        if (
          roundedProb > roundedProbThreshold ||
          roundedAmount > roundedAmountThreshold
        ) {
          const rainBullets: string[] = []
          if (roundedProb > roundedProbThreshold) {
            rainBullets.push(
              `Precipitation probability is ${roundedProb}%, which exceeds your threshold of ${roundedProbThreshold}%.`
            )
          }
          if (roundedAmount > roundedAmountThreshold) {
            rainBullets.push(
              `Precipitation amount is ${roundedAmount} mm, which exceeds your threshold of ${roundedAmountThreshold} mm.`
            )
          }
          badgesList.push({
            key: 'rain_ready',
            label: 'Rain-ready',
            bullets: rainBullets,
          })
        }

        // Evening chill trigger
        if (scenario === 'evening' && roundedAdjustedFeelsLike < 15) {
          badgesList.push({
            key: 'evening_chill',
            label: 'Evening chill',
            bullets: [
              `Evening feels-like temperature is ${getFeelsLikeDesc(
                segment.feels_like,
                adjustedFeelsLike
              )}, which is below the evening chill threshold of 15°C.`,
            ],
          })
        }

        // Default scenario / temperature badges
        if (badgesList.length === 0) {
          if (scenario === 'morning' && roundedAdjustedFeelsLike < 12) {
            badgesList.push({
              key: 'commute_warmth',
              label: 'Commute warmth',
              bullets: [
                `Morning feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is below the commute warmth threshold of 12°C.`,
              ],
            })
          } else if (segment.condition === 'clear' && roundedAdjustedFeelsLike >= 22) {
            badgesList.push({
              key: 'sun_protection',
              label: 'Sun protection',
              bullets: [
                `Skies are clear and feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is at or above 22°C.`,
              ],
            })
          } else if (roundedAdjustedFeelsLike >= 15 && roundedAdjustedFeelsLike < 22) {
            badgesList.push({
              key: 'light_layers',
              label: 'Light layers',
              bullets: [
                `Feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is between 15°C and 22°C.`,
              ],
            })
          } else if (roundedAdjustedFeelsLike >= 25) {
            badgesList.push({
              key: 'breathable_comfort',
              label: 'Breathable comfort',
              bullets: [
                `Feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}, which is at or above 25°C.`,
              ],
            })
          } else {
            badgesList.push({
              key: 'daily_base',
              label: 'Daily base',
              bullets: [
                `Feels-like temperature is ${getFeelsLikeDesc(
                  segment.feels_like,
                  adjustedFeelsLike
                )}.`,
              ],
            })
          }
        }

        // Write to database
        if (recommendation) {
          try {
            recommendation = await this.prisma.outfitRecommendation.update({
              where: { id: recommendation.id },
              data: {
                garment_ids: garmentIds,
                reasoning_badges: badgesList,
              },
            })
          } catch (error) {
            console.warn(
              'Failed to update stale recommendation:',
              error instanceof Error ? error.message : error
            )
            throw error
          }
        } else {
          try {
            recommendation = await this.prisma.outfitRecommendation.create({
              data: {
                user_id: userId,
                forecast_segment_id: segment.id,
                scenario,
                garment_ids: garmentIds,
                reasoning_badges: badgesList,
              },
            })
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              recommendation = await this.prisma.outfitRecommendation.findFirst({
                where: {
                  user_id: userId,
                  forecast_segment_id: segment.id,
                  scenario,
                },
              })
              if (!recommendation) {
                throw error
              }
            } else {
              throw error
            }
          }
        }
      }

      // Generate dynamic comfort notes for the response
      let adjustedFeelsLike = segment.feels_like
      if (runsColdWarm === 'cold') {
        adjustedFeelsLike -= 3
      } else if (runsColdWarm === 'warm') {
        adjustedFeelsLike += 3
      }

      const dict = comfortNotesTranslations[locale]
      const notes: string[] = []

      const toLocalizedTemperature = (temperatureCelsius: number) =>
        Math.round(
          locale === 'en-US' ? (temperatureCelsius * 9) / 5 + 32 : temperatureCelsius
        ).toString()
      const feelsLikeStr = toLocalizedTemperature(segment.feels_like)
      const adjustedFeelsLikeStr = toLocalizedTemperature(adjustedFeelsLike)

      if (runsColdWarm !== 'neutral') {
        notes.push(
          dict.feels_like_adjusted
            .replace('{feelsLike}', feelsLikeStr)
            .replace('{adjustedFeelsLike}', adjustedFeelsLikeStr)
        )
      } else {
        notes.push(dict.feels_like_neutral.replace('{feelsLike}', feelsLikeStr))
      }

      if (adjustedFeelsLike < 10) {
        notes.push(dict.cold)
      } else if (adjustedFeelsLike < 15) {
        notes.push(dict.chilly)
      } else if (adjustedFeelsLike < 20) {
        notes.push(dict.mild)
      } else if (adjustedFeelsLike < 25) {
        notes.push(dict.warm)
      } else {
        notes.push(dict.hot)
      }

      const windLimit = getWindThreshold(windTolerance)
      if (segment.wind_speed > windLimit) {
        notes.push(dict.windy.replace('{windSpeed}', segment.wind_speed.toString()))
      }

      const rainProbLimit = getRainProbThreshold(precipPreparedness)
      if (segment.precipitation_probability > rainProbLimit) {
        notes.push(dict.rainy)
      }

      const comfortNotes = notes.join(' ')

      const rec = recommendation

      outfits.push({
        id: rec.id,
        scenario: rec.scenario as ScenarioName,
        garmentIds: (rec.garment_ids as string[]) || [],
        reasoningBadges: (Array.isArray(rec.reasoning_badges)
          ? (rec.reasoning_badges as unknown as {
              key?: string
              label?: string
              bullets?: string[]
            }[])
          : []
        )
          .filter(
            (badge): badge is { key?: string; label?: string; bullets?: string[] } => {
              return badge !== null && typeof badge === 'object'
            }
          )
          .map((badge) => mapRawBadgeToCanonical(badge, locale)),
        comfortNotes: comfortNotes,
      })
    }

    // 7. Compile Response data
    const generalBadges = Array.from(
      new Set(outfits.flatMap((o) => o.reasoningBadges.map((b) => b.label)))
    )

    const responseData = {
      weather: toWeatherSnapshot(weatherSnapshot),
      outfits,
      badges: generalBadges,
    }

    // 8. Write to Redis Cache
    const cachePayload = {
      generatedAt: new Date().toISOString(),
      weather: responseData.weather,
      data: responseData,
    }
    try {
      await this.redis.set(cacheKey, JSON.stringify(cachePayload), 'EX', 900)
    } catch (err) {
      console.warn('Redis cache set failed:', err instanceof Error ? err.message : err)
    }

    return responseData
  }

  // Story 2.2 Task 2 step 3 owner: implement chunk-based Redis key invalidation
  async invalidateUserCache(userId: string): Promise<void> {
    try {
      const matchPattern = `ritual:${userId}:*`
      let cursor = '0'
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          matchPattern,
          'COUNT',
          100
        )
        cursor = nextCursor
        if (keys.length > 0) {
          await this.redis.del(keys)
        }
      } while (cursor !== '0')
    } catch (err) {
      this.logger.warn(
        `Redis cache invalidation failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  async onModuleDestroy() {
    await this.redis.quit()
  }
}
