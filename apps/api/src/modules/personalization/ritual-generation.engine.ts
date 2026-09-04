// Story 5.5 Decision 1: the pure generation core extracted from
// `RitualService.getOrCreateRitual`. This module owns no I/O -- no Prisma,
// no Redis, no HTTP -- so both `RitualService` (one ritual date, one
// forecast segment, wrapped in its existing cache/persistence) and the
// planner (seven dates, no persistence identity of its own) can call it
// directly without either owning the other's caching or storage concerns.
//
// A load-bearing split inside this file: `generateRitualScenarios` returns
// ENGLISH canonical `reasoningBadges`, never locale-baked. `RitualService`
// persists that exact English form into `OutfitRecommendation.reasoning_badges`
// and a later read in a *different* locale re-localizes it via
// `mapRawBadgeToCanonical`, keyed on the badge's canonical `key` rather than
// its current label -- baking a locale into the stored badges would corrupt
// that re-read (see Decision 1 discussion in the story). `comfortNotes` is
// the opposite: it is never persisted by `RitualService` (recomputed fresh
// every request), so it is safe -- and required by Decision 1's "locale"
// input -- for the engine to return it already localized. The planner
// (Task 6) persists both by calling `mapRawBadgeToCanonical` itself once at
// generation time, which is exactly why Decision 2 folds locale into its
// dependency fingerprint: a locale change must force a regenerate.
import type { GarmentItem } from '@prisma/client'
import type { CapsuleOccasion } from '@couture/api-client'
import {
  evaluateCapsuleForScenario,
  type CapsuleWithJoins,
} from './capsule-recommendation.engine.js'
import type {
  PrecipPreparedness,
  ScenarioName,
  SupportedLocale,
  WindTolerance,
} from '../../contracts/http.js'

// ---------------------------------------------------------------------------
// Timezone-aware date/hour formatting (Decision 2's date helpers live here).
// ---------------------------------------------------------------------------

const formattersMap = new Map<string, Intl.DateTimeFormat>()

export function getHourInTimezone(date: Date, timezone: string): number {
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

export function getLocalDateString(date: Date, timezone: string): string {
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

/**
 * Story 5.5 Decision 2: the existing ritual cutoff, lifted verbatim. Before
 * 08:00 local, the anchor is today; from 08:00 onward it rolls to tomorrow.
 */
export function resolveRitualAnchorDate(now: Date, timezone: string): string {
  const currentLocalHour = getHourInTimezone(now, timezone)
  let targetTime = now.getTime()
  if (currentLocalHour >= 8) {
    targetTime += 24 * 60 * 60 * 1000
  }
  return getLocalDateString(new Date(targetTime), timezone)
}

interface LocalDateParts {
  year: number
  month: number
  day: number
}

/**
 * Validates a `YYYY-MM-DD` string as a real calendar date (not just the
 * digit shape) and returns its numeric parts. UTC date-part arithmetic on
 * the result is what keeps `resolvePlannerDateWindow` immune to
 * daylight-saving transitions: it never constructs a local-timezone `Date`.
 */
function parseLocalDateParts(localDate: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  if (!match) {
    throw new Error(`Invalid local date: ${localDate}`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local date: ${localDate}`)
  }
  return { year, month, day }
}

function formatUtcDateParts(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Story 5.5 Decision 2: seven consecutive local dates starting at
 * `anchorDate`, computed with UTC date-part arithmetic on a validated
 * date-only string so a daylight-saving transition can never skip or
 * duplicate a date.
 */
export function resolvePlannerDateWindow(
  anchorDate: string
): readonly [string, string, string, string, string, string, string] {
  const { year, month, day } = parseLocalDateParts(anchorDate)
  const dates = Array.from({ length: 7 }, (_, offset) =>
    formatUtcDateParts(new Date(Date.UTC(year, month - 1, day + offset)))
  )
  return dates as unknown as readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ]
}

/**
 * Story 5.5 Decision 2: stores a local calendar label as UTC midnight, the
 * representation the Prisma `@db.Date` field expects. Clients must format
 * `planDate` back out through an explicit UTC formatter, never an implicit
 * local `Date` constructor, or the label can drift by a day near midnight.
 */
export function toDatabaseDate(localDate: string): Date {
  const { year, month, day } = parseLocalDateParts(localDate)
  return new Date(Date.UTC(year, month - 1, day))
}

// ---------------------------------------------------------------------------
// Comfort thresholds (verbatim from RitualService).
// ---------------------------------------------------------------------------

const WIND_THRESHOLD_M_S: Record<WindTolerance, number> = {
  low: 3,
  medium: 5,
  high: 8,
} as const

const PRECIP_PROB_THRESHOLD: Record<PrecipPreparedness, number> = {
  high: 0.2,
  medium: 0.4,
  low: 0.7,
} as const

const PRECIP_AMOUNT_THRESHOLD_MM: Record<PrecipPreparedness, number> = {
  high: 0.1,
  medium: 0.5,
  low: 2.0,
} as const

export function getWindThreshold(windTolerance: WindTolerance): number {
  return WIND_THRESHOLD_M_S[windTolerance] ?? 5.0
}

export function getRainProbThreshold(precipPreparedness: PrecipPreparedness): number {
  return PRECIP_PROB_THRESHOLD[precipPreparedness] ?? 0.3
}

export function getRainAmountThreshold(precipPreparedness: PrecipPreparedness): number {
  return PRECIP_AMOUNT_THRESHOLD_MM[precipPreparedness] ?? 0.1
}

function resolveComfortRangeFromTemperature(adjustedFeelsLike: number): string {
  if (adjustedFeelsLike < 10) return 'cold'
  if (adjustedFeelsLike < 15) return 'cool'
  if (adjustedFeelsLike < 20) return 'mild'
  if (adjustedFeelsLike < 25) return 'warm'
  return 'hot'
}

// ---------------------------------------------------------------------------
// Temperature localization (verbatim from RitualService).
// ---------------------------------------------------------------------------

export function toLocalizedTemperature(
  temperatureCelsius: number,
  locale: SupportedLocale
): string {
  return Math.round(
    locale === 'en-US' ? (temperatureCelsius * 9) / 5 + 32 : temperatureCelsius
  ).toString()
}

export function localizeTemperatureTokens(text: string, locale: SupportedLocale): string {
  if (locale !== 'en-US') {
    return text
  }

  return text.replace(/(-?\d+(?:\.\d+)?)°C/g, (_match, rawTemperature: string) => {
    const localizedTemperature = toLocalizedTemperature(
      Number.parseFloat(rawTemperature),
      locale
    )
    return `${localizedTemperature}°F`
  })
}

// ---------------------------------------------------------------------------
// Comfort notes translations (verbatim, plus a new `weatherUnavailable` key
// for Story 5.5's honest-degradation baseline -- AC 2: "no weather-derived
// badge or precision claim").
// ---------------------------------------------------------------------------

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
  weatherUnavailable: string
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
    weatherUnavailable:
      "Weather isn't available for this date, so we picked a versatile everyday outfit.",
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
    weatherUnavailable:
      "Weather isn't available for this date, so we picked a versatile everyday outfit.",
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
    weatherUnavailable:
      'El clima no está disponible para esta fecha, así que elegimos un look versátil para el día a día.',
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
    weatherUnavailable:
      'La météo n’est pas disponible pour cette date, nous avons donc choisi une tenue polyvalente pour tous les jours.',
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
    weatherUnavailable:
      'La météo n’est pas disponible pour cette date, nous avons donc choisi une tenue polyvalente pour tous les jours.',
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
    weatherUnavailable:
      'Bu tarih için hava durumu bilgisi yok, bu yüzden çok yönlü, günlük bir kombin seçtik.',
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
    weatherUnavailable:
      'Für dieses Datum sind keine Wetterdaten verfügbar, daher haben wir ein vielseitiges Alltagsoutfit ausgewählt.',
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
    weatherUnavailable:
      'Il meteo non è disponibile per questa data, quindi abbiamo scelto un outfit versatile per tutti i giorni.',
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
    weatherUnavailable:
      'O clima não está disponível para esta data, então escolhemos um look versátil para o dia a dia.',
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
    weatherUnavailable:
      'O tempo não está disponível para esta data, por isso escolhemos um look versátil para o dia a dia.',
  },
}

// ---------------------------------------------------------------------------
// Badge canonicalization/localization (verbatim from RitualService).
// ---------------------------------------------------------------------------

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
    saved_capsule: {
      label: 'Saved capsule',
      bullets: ['Selected from your saved capsule'],
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
    saved_capsule: {
      label: 'Saved capsule',
      bullets: ['Selected from your saved capsule'],
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
    saved_capsule: {
      label: 'Cápsula guardada',
      bullets: ['Seleccionado de tu cápsula guardada'],
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
    saved_capsule: {
      label: 'Capsule enregistrée',
      bullets: ['Sélectionné depuis votre capsule enregistrée'],
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
    saved_capsule: {
      label: 'Capsule enregistrée',
      bullets: ['Sélectionné depuis votre capsule enregistrée'],
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
    saved_capsule: {
      label: 'Kaydedilen kapsül',
      bullets: ['Kaydedilen kapsülünüzden seçildi'],
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
    saved_capsule: {
      label: 'Gespeicherte Kapsel',
      bullets: ['Aus Ihrer gespeicherten Kapsel ausgewählt'],
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
    saved_capsule: {
      label: 'Capsula salvata',
      bullets: ['Selezionato dalla tua capsula salvata'],
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
    saved_capsule: {
      label: 'Cápsula salva',
      bullets: ['Selecionado da sua cápsula salva'],
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
    saved_capsule: {
      label: 'Cápsula guardada',
      bullets: ['Selecionado da sua cápsula guardada'],
    },
  },
}

export type RawReasoningBadge = {
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

const defaultLocale: SupportedLocale = 'en-US'

export function mapRawBadgeToCanonical(
  badge: RawReasoningBadge,
  locale: SupportedLocale = defaultLocale
): { key: string; label: string; bullets: string[] } {
  const key = resolveCanonicalBadgeKey(badge)
  if (!key) {
    return preserveCustomBadge(badge)
  }

  const localized = badgeTranslations[locale][key]
  const sourceBullets = validBadgeBullets(badge.bullets)
  const localizedSourceBullets = sourceBullets.map((bullet) =>
    localizeTemperatureTokens(bullet, locale)
  )
  const shouldLocalizeBullets = locale !== 'en-US' && locale !== 'en-CA'
  const bullets =
    shouldLocalizeBullets && localized?.bullets.length
      ? localized.bullets
      : sourceBullets.length > 0
        ? localizedSourceBullets
        : (localized?.bullets ?? [])

  return {
    key,
    label: localized?.label ?? badge.label ?? badge.key ?? 'Daily base',
    bullets,
  }
}

// ---------------------------------------------------------------------------
// Weather inputs (Decision 1: three per-scenario values, or unavailable).
// ---------------------------------------------------------------------------

export interface ScenarioWeatherInput {
  scenario: ScenarioName
  feelsLike: number
  windSpeed: number
  precipitationProbability: number
  precipitationAmount: number
  condition: string
  /**
   * Story 5.5 Decision 3: whether this value came from an exact hourly
   * segment or a daily-summary projection. Daily-sourced badges carry a
   * visible evidence note so a user never mistakes a projected value for a
   * precise hourly reading.
   */
  source: 'hourly' | 'daily'
}

export type EngineWeatherInput =
  | {
      status: 'available'
      scenarios: readonly [
        ScenarioWeatherInput,
        ScenarioWeatherInput,
        ScenarioWeatherInput,
      ]
    }
  | { status: 'unavailable' }

export interface ComfortPreferencesInput {
  runsColdWarm: 'cold' | 'warm' | 'neutral'
  windTolerance: WindTolerance
  precipPreparedness: PrecipPreparedness
}

export interface GenerationExclusions {
  garmentIds?: readonly string[]
  capsuleIds?: readonly string[]
}

export interface RitualGenerationEngineInput {
  /** Accepted for interface completeness (Decision 1); not read by the pure math. */
  userId: string
  targetLocalDate: string
  locale: SupportedLocale
  comfortPreferences: ComfortPreferencesInput
  eligibleGarments: readonly GarmentItem[]
  eligibleCapsules: readonly CapsuleWithJoins[]
  weather: EngineWeatherInput
  occasion?: CapsuleOccasion
  exclusions?: GenerationExclusions
}

export interface RitualGenerationScenarioResult {
  id: string
  scenario: ScenarioName
  garmentIds: string[]
  capsuleId: string | null
  capsuleName: string | null
  autoFilledGarmentIds: string[]
  /** English canonical form -- see the module header for why this is never locale-baked. */
  reasoningBadges: { key: string; label: string; bullets: string[] }[]
  /** Localized per `locale` -- safe because comfort notes are never persisted raw. */
  comfortNotes: string
  /** True when any required slot fell back to a `default-${category}` placeholder. */
  isStarterWardrobe: boolean
}

export interface RitualGenerationResult {
  scenarios: readonly [
    RitualGenerationScenarioResult,
    RitualGenerationScenarioResult,
    RitualGenerationScenarioResult,
  ]
}

const CLOSE_COMFORT_MATCHES: Record<string, string[]> = {
  cold: ['cool'],
  cool: ['mild', 'cold'],
  mild: ['cool', 'warm'],
  warm: ['mild', 'hot'],
  hot: ['warm'],
}

function pickBestGarment(
  candidates: readonly GarmentItem[],
  targetComfortRange: string
): GarmentItem | undefined {
  const exact = candidates.find((g) => g.comfort_range === targetComfortRange)
  if (exact) return exact

  const preferences = CLOSE_COMFORT_MATCHES[targetComfortRange] || []
  for (const pref of preferences) {
    const match = candidates.find((g) => g.comfort_range === pref)
    if (match) return match
  }

  return candidates[0]
}

/**
 * Story 5.5 Decision 1/AC 4: `excludedGarmentIds` is a soft preference, not a
 * hard filter. A category with real eligible garments never degrades to a
 * `default-${category}` placeholder just because reshuffle's exclusion list
 * happened to exclude the only item that category has -- the exclusion is
 * dropped for that one slot and the best excluded candidate is reused
 * instead. A placeholder is reserved for a category with zero eligible
 * garments at all, exclusions aside.
 */
function selectGenericGarments(
  requiredCategories: readonly string[],
  eligibleGarments: readonly GarmentItem[],
  targetComfortRange: string,
  excludedGarmentIds: ReadonlySet<string> = new Set()
): { garmentIds: string[]; usedPlaceholder: boolean } {
  let usedPlaceholder = false

  const garmentIds = requiredCategories.map((category) => {
    const allCandidates = eligibleGarments.filter((g) => g.category === category)
    if (allCandidates.length === 0) {
      usedPlaceholder = true
      return `default-${category}`
    }

    const preferredCandidates = allCandidates.filter((g) => !excludedGarmentIds.has(g.id))
    const chosen =
      pickBestGarment(preferredCandidates, targetComfortRange) ??
      pickBestGarment(allCandidates, targetComfortRange)
    return chosen!.id
  })

  return { garmentIds, usedPlaceholder }
}

function withEvidenceSuffix(bullets: string[], source: 'hourly' | 'daily'): string[] {
  if (source !== 'daily') {
    return bullets
  }
  return bullets.map((bullet) => `${bullet} (from the day’s summary forecast)`)
}

function buildComfortNotes(
  weather: Pick<
    ScenarioWeatherInput,
    'feelsLike' | 'windSpeed' | 'precipitationProbability'
  >,
  comfortPreferences: ComfortPreferencesInput,
  locale: SupportedLocale
): string {
  const { runsColdWarm, windTolerance, precipPreparedness } = comfortPreferences
  let adjustedFeelsLike = weather.feelsLike
  if (runsColdWarm === 'cold') adjustedFeelsLike -= 3
  else if (runsColdWarm === 'warm') adjustedFeelsLike += 3

  const dict = comfortNotesTranslations[locale]
  const notes: string[] = []

  const feelsLikeStr = toLocalizedTemperature(weather.feelsLike, locale)
  const adjustedFeelsLikeStr = toLocalizedTemperature(adjustedFeelsLike, locale)

  if (runsColdWarm !== 'neutral') {
    notes.push(
      dict.feels_like_adjusted
        .replace('{feelsLike}', feelsLikeStr)
        .replace('{adjustedFeelsLike}', adjustedFeelsLikeStr)
    )
  } else {
    notes.push(dict.feels_like_neutral.replace('{feelsLike}', feelsLikeStr))
  }

  if (adjustedFeelsLike < 10) notes.push(dict.cold)
  else if (adjustedFeelsLike < 15) notes.push(dict.chilly)
  else if (adjustedFeelsLike < 20) notes.push(dict.mild)
  else if (adjustedFeelsLike < 25) notes.push(dict.warm)
  else notes.push(dict.hot)

  const windLimit = getWindThreshold(windTolerance)
  if (weather.windSpeed > windLimit) {
    const windSpeed = Math.round(weather.windSpeed * 10) / 10
    notes.push(dict.windy.replace('{windSpeed}', windSpeed.toString()))
  }

  const rainProbLimit = getRainProbThreshold(precipPreparedness)
  if (weather.precipitationProbability > rainProbLimit) {
    notes.push(dict.rainy)
  }

  return notes.join(' ')
}

// eslint-disable-next-line complexity
function generateAvailableScenario(
  weather: ScenarioWeatherInput,
  input: RitualGenerationEngineInput
): RitualGenerationScenarioResult {
  const { comfortPreferences, occasion, locale, targetLocalDate } = input
  const { runsColdWarm, windTolerance, precipPreparedness } = comfortPreferences
  const excludedGarmentIds = new Set(input.exclusions?.garmentIds ?? [])
  const excludedCapsuleIds = new Set(input.exclusions?.capsuleIds ?? [])
  const eligibleGarments = input.eligibleGarments.filter(
    (garment) => !excludedGarmentIds.has(garment.id)
  )
  const eligibleCapsules = input.eligibleCapsules.filter(
    (capsule) => !excludedCapsuleIds.has(capsule.id)
  )

  let adjustedFeelsLike = weather.feelsLike
  if (runsColdWarm === 'cold') adjustedFeelsLike -= 3
  else if (runsColdWarm === 'warm') adjustedFeelsLike += 3

  const capsuleEval = evaluateCapsuleForScenario({
    capsules: eligibleCapsules,
    userGarments: eligibleGarments,
    adjustedFeelsLike,
    requestedOccasion: occasion,
  })
  const recommendedCapsule = capsuleEval?.capsule

  let requiredCategories: string[]
  if (adjustedFeelsLike < 15) {
    requiredCategories = ['outerwear', 'top', 'bottom', 'shoes']
  } else {
    const hasDress = eligibleGarments.some((g) => g.category === 'dress')
    requiredCategories = hasDress ? ['dress', 'shoes'] : ['top', 'bottom', 'shoes']
  }

  const targetComfortRange = resolveComfortRangeFromTemperature(adjustedFeelsLike)
  // Soft exclusion for the generic path: `input.eligibleGarments` (not the
  // hard-filtered `eligibleGarments` above) so a category with real garments
  // never degrades to a placeholder just because its only item was excluded.
  const { garmentIds: genericGarmentIds, usedPlaceholder } = selectGenericGarments(
    requiredCategories,
    input.eligibleGarments,
    targetComfortRange,
    excludedGarmentIds
  )

  const garmentIds = capsuleEval ? capsuleEval.garmentIds : genericGarmentIds
  const isStarterWardrobe = capsuleEval ? false : usedPlaceholder

  const roundedAdjustedFeelsLike = Math.round(adjustedFeelsLike)
  const getFeelsLikeDesc = (raw: number, adjusted: number): string => {
    const roundedRaw = Math.round(raw)
    const roundedAdj = Math.round(adjusted)
    if (roundedRaw === roundedAdj) {
      return `${roundedRaw}°C`
    }
    return `${roundedRaw}°C (adjusted to ${roundedAdj}°C)`
  }

  const badgesList: { key: string; label: string; bullets: string[] }[] = []

  if (recommendedCapsule) {
    badgesList.push({
      key: 'saved_capsule',
      label: 'Saved capsule',
      bullets: ['Selected from your saved capsule'],
    })
  }

  const windThreshold = getWindThreshold(windTolerance)
  if (weather.windSpeed > windThreshold) {
    const windSpeedFormatted = Math.round(weather.windSpeed * 10) / 10
    badgesList.push({
      key: 'wind_layer',
      label: 'Wind layer',
      bullets: withEvidenceSuffix(
        [
          `Wind speed is ${windSpeedFormatted} m/s, which exceeds your wind tolerance threshold of ${windThreshold} m/s.`,
        ],
        weather.source
      ),
    })
  }

  const rainProbThreshold = getRainProbThreshold(precipPreparedness)
  const rainAmountThreshold = getRainAmountThreshold(precipPreparedness)
  const roundedProb = Math.round(weather.precipitationProbability * 100)
  const roundedProbThreshold = Math.round(rainProbThreshold * 100)
  const roundedAmount = Math.round(weather.precipitationAmount * 10) / 10
  const roundedAmountThreshold = Math.round(rainAmountThreshold * 10) / 10

  if (roundedProb > roundedProbThreshold || roundedAmount > roundedAmountThreshold) {
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
      bullets: withEvidenceSuffix(rainBullets, weather.source),
    })
  }

  if (weather.scenario === 'evening' && roundedAdjustedFeelsLike < 15) {
    badgesList.push({
      key: 'evening_chill',
      label: 'Evening chill',
      bullets: withEvidenceSuffix(
        [
          `Evening feels-like temperature is ${getFeelsLikeDesc(
            weather.feelsLike,
            adjustedFeelsLike
          )}, which is below the evening chill threshold of 15°C.`,
        ],
        weather.source
      ),
    })
  }

  if (badgesList.length === 0) {
    if (weather.scenario === 'morning' && roundedAdjustedFeelsLike < 12) {
      badgesList.push({
        key: 'commute_warmth',
        label: 'Commute warmth',
        bullets: withEvidenceSuffix(
          [
            `Morning feels-like temperature is ${getFeelsLikeDesc(
              weather.feelsLike,
              adjustedFeelsLike
            )}, which is below the commute warmth threshold of 12°C.`,
          ],
          weather.source
        ),
      })
    } else if (weather.condition === 'clear' && roundedAdjustedFeelsLike >= 22) {
      badgesList.push({
        key: 'sun_protection',
        label: 'Sun protection',
        bullets: withEvidenceSuffix(
          [
            `Skies are clear and feels-like temperature is ${getFeelsLikeDesc(
              weather.feelsLike,
              adjustedFeelsLike
            )}, which is at or above 22°C.`,
          ],
          weather.source
        ),
      })
    } else if (roundedAdjustedFeelsLike >= 15 && roundedAdjustedFeelsLike < 22) {
      badgesList.push({
        key: 'light_layers',
        label: 'Light layers',
        bullets: withEvidenceSuffix(
          [
            `Feels-like temperature is ${getFeelsLikeDesc(
              weather.feelsLike,
              adjustedFeelsLike
            )}, which is between 15°C and 22°C.`,
          ],
          weather.source
        ),
      })
    } else if (roundedAdjustedFeelsLike >= 25) {
      badgesList.push({
        key: 'breathable_comfort',
        label: 'Breathable comfort',
        bullets: withEvidenceSuffix(
          [
            `Feels-like temperature is ${getFeelsLikeDesc(
              weather.feelsLike,
              adjustedFeelsLike
            )}, which is at or above 25°C.`,
          ],
          weather.source
        ),
      })
    } else {
      badgesList.push({
        key: 'daily_base',
        label: 'Daily base',
        bullets: withEvidenceSuffix(
          [
            `Feels-like temperature is ${getFeelsLikeDesc(weather.feelsLike, adjustedFeelsLike)}.`,
          ],
          weather.source
        ),
      })
    }
  }

  return {
    id: `${targetLocalDate}-${weather.scenario}`,
    scenario: weather.scenario,
    garmentIds,
    capsuleId: recommendedCapsule?.id ?? null,
    capsuleName: recommendedCapsule?.name ?? null,
    autoFilledGarmentIds: capsuleEval ? capsuleEval.autoFilledGarmentIds : [],
    reasoningBadges: badgesList,
    comfortNotes: buildComfortNotes(weather, comfortPreferences, locale),
    isStarterWardrobe,
  }
}

/**
 * Story 5.5 AC 2 / Decision 3: a date with no usable weather still gets a
 * wardrobe-and-comfort-preference baseline -- a deterministic all-season
 * pick nudged by the user's run-cold/run-warm preference -- with zero
 * weather-derived badges and no precision claim. Capsule scoring is
 * deliberately skipped: it needs a real feels-like temperature to score
 * comfort against, and this branch has none.
 */
function generateUnavailableScenario(
  scenario: ScenarioName,
  input: RitualGenerationEngineInput
): RitualGenerationScenarioResult {
  const { comfortPreferences, locale, targetLocalDate } = input
  const excludedGarmentIds = new Set(input.exclusions?.garmentIds ?? [])
  const eligibleGarments = input.eligibleGarments.filter(
    (garment) => !excludedGarmentIds.has(garment.id)
  )

  const targetComfortRange =
    comfortPreferences.runsColdWarm === 'cold'
      ? 'cool'
      : comfortPreferences.runsColdWarm === 'warm'
        ? 'warm'
        : 'mild'
  const hasDress = eligibleGarments.some((g) => g.category === 'dress')
  const requiredCategories = hasDress ? ['dress', 'shoes'] : ['top', 'bottom', 'shoes']
  const { garmentIds, usedPlaceholder } = selectGenericGarments(
    requiredCategories,
    eligibleGarments,
    targetComfortRange
  )

  return {
    id: `${targetLocalDate}-${scenario}`,
    scenario,
    garmentIds,
    capsuleId: null,
    capsuleName: null,
    autoFilledGarmentIds: [],
    reasoningBadges: [],
    comfortNotes: comfortNotesTranslations[locale].weatherUnavailable,
    isStarterWardrobe: usedPlaceholder,
  }
}

/**
 * Story 5.5 Decision 1: the single entry point. One call generates all
 * three scenarios (morning, midday, evening) for one date.
 */
export function generateRitualScenarios(
  input: RitualGenerationEngineInput
): RitualGenerationResult {
  if (input.weather.status === 'unavailable') {
    return {
      scenarios: [
        generateUnavailableScenario('morning', input),
        generateUnavailableScenario('midday', input),
        generateUnavailableScenario('evening', input),
      ],
    }
  }

  const [morning, midday, evening] = input.weather.scenarios
  return {
    scenarios: [
      generateAvailableScenario(morning, input),
      generateAvailableScenario(midday, input),
      generateAvailableScenario(evening, input),
    ],
  }
}

// ---------------------------------------------------------------------------
// Hourly segment matching (Decision 3's "hourly adapter": picks the exact
// 08:00/13:00/19:00 segments for a date, with RitualService's existing
// fallback-to-most-recent-fully-covered-date behavior).
// ---------------------------------------------------------------------------

export interface HourlySegmentLike {
  id: string
  forecast_at: Date
  feels_like: number
  wind_speed: number
  precipitation_probability: number
  precipitation_amount: number
  condition: string
}

export interface MatchedHourlySegments<T extends HourlySegmentLike> {
  morning: T
  midday: T
  evening: T
  resolvedLocalDate: string
}

/**
 * Finds the morning (08:00) / midday (13:00) / evening (19:00) segments for
 * `targetLocalDate` in `timezone`. When that date has no full triple, falls
 * back to the most recent date (scanning backward through the unique dates
 * present) that does.
 */
export function matchHourlyScenarioSegments<T extends HourlySegmentLike>(
  segments: readonly T[],
  timezone: string,
  targetLocalDate: string
): MatchedHourlySegments<T> | null {
  const findTriple = (dateStr: string): { morning?: T; midday?: T; evening?: T } => ({
    morning: segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === dateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 8
    ),
    midday: segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === dateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 13
    ),
    evening: segments.find(
      (s) =>
        getLocalDateString(s.forecast_at, timezone) === dateStr &&
        getHourInTimezone(s.forecast_at, timezone) === 19
    ),
  })

  const direct = findTriple(targetLocalDate)
  if (direct.morning && direct.midday && direct.evening) {
    return {
      morning: direct.morning,
      midday: direct.midday,
      evening: direct.evening,
      resolvedLocalDate: targetLocalDate,
    }
  }

  const uniqueDates = [
    ...new Set(segments.map((s) => getLocalDateString(s.forecast_at, timezone))),
  ]
  for (const fallbackDate of uniqueDates.reverse()) {
    const fallback = findTriple(fallbackDate)
    if (fallback.morning && fallback.midday && fallback.evening) {
      return {
        morning: fallback.morning,
        midday: fallback.midday,
        evening: fallback.evening,
        resolvedLocalDate: fallbackDate,
      }
    }
  }

  return null
}

export function hourlySegmentToScenarioInput(
  scenario: ScenarioName,
  segment: HourlySegmentLike
): ScenarioWeatherInput {
  return {
    scenario,
    feelsLike: segment.feels_like,
    windSpeed: segment.wind_speed,
    precipitationProbability: segment.precipitation_probability,
    precipitationAmount: segment.precipitation_amount,
    condition: segment.condition,
    source: 'hourly',
  }
}

// ---------------------------------------------------------------------------
// Daily-projection adapter (Decision 3's "daily-projection adapter").
// ---------------------------------------------------------------------------

export interface DailyWeatherLike {
  temperatureMin: number
  temperatureMax: number
  feelsLikeMin?: number
  feelsLikeMax?: number
  precipitationProbability: number
  precipitationAmount: number
  windSpeed: number
  condition: string
}

/**
 * Story 5.5 Decision 3: morning = daily minimum, midday = daily maximum,
 * evening = midpoint of minimum and maximum. Feels-like bounds are used
 * when the provider supplied them, temperature bounds otherwise. Wind and
 * precipitation are shared across all three scenarios, as specified.
 */
export function dailyProjectionToScenarioInputs(
  daily: DailyWeatherLike
): readonly [ScenarioWeatherInput, ScenarioWeatherInput, ScenarioWeatherInput] {
  const min = daily.feelsLikeMin ?? daily.temperatureMin
  const max = daily.feelsLikeMax ?? daily.temperatureMax
  const midpoint = (min + max) / 2

  const shared = {
    windSpeed: daily.windSpeed,
    precipitationProbability: daily.precipitationProbability,
    precipitationAmount: daily.precipitationAmount,
    condition: daily.condition,
    source: 'daily' as const,
  }

  return [
    { scenario: 'morning', feelsLike: min, ...shared },
    { scenario: 'midday', feelsLike: max, ...shared },
    { scenario: 'evening', feelsLike: midpoint, ...shared },
  ]
}
