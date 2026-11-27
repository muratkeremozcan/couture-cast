// Story 5.5 Task 2 step 1 owner: own the date helpers, the comfort thresholds, the badge and comfort-note localization tables, the exclusion behaviour and `generateRitualScenarios` in `apps/api/src/modules/personalization/ritual-generation.engine.ts`
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
  adjustFeelsLike,
  buildSampleContext,
  CLOSE_COMFORT_MATCHES,
  getRainProbThreshold,
  getWindThreshold,
  needsOuterwear,
  rainAmountExceeds,
  rainProbabilityExceeds,
  resolveComfortRangeFromTemperature,
  SAMPLE_CATALOG,
  selectSampleOutfit,
  windExceeds,
  type ComfortRange,
  type GarmentSubtype,
  type SampleGarmentCategory,
  type SampleSelectionInput,
} from '@couture/utils'
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
// Comfort thresholds and comparisons live in @couture/utils (Story 6.16) so the
// guest sample policy applies the same rules.
// ---------------------------------------------------------------------------

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
// Comfort notes shown beside the outfit, including the unavailable-weather state.
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
      'Feels like {feelsLike}°F. We planned for {adjustedFeelsLike}°F to suit you.',
    feels_like_neutral: 'Feels like {feelsLike}°F.',
    cold: 'Wear a warm coat.',
    chilly: 'Take a jacket.',
    mild: 'Wear light layers.',
    warm: 'Try a top with pants or a dress.',
    hot: 'Wear light clothes to stay cool.',
    windy: 'Wind is strong at {windSpeed} m/s. Take a jacket.',
    rainy: 'Rain may come. Take an umbrella or raincoat.',
    weatherUnavailable: 'We picked a look you can wear any day. The forecast is missing.',
  },
  'en-CA': {
    feels_like_adjusted:
      'Feels like {feelsLike}°C. We planned for {adjustedFeelsLike}°C to suit you.',
    feels_like_neutral: 'Feels like {feelsLike}°C.',
    cold: 'Wear a warm coat.',
    chilly: 'Take a jacket.',
    mild: 'Wear light layers.',
    warm: 'Try a top with pants or a dress.',
    hot: 'Wear light clothes to stay cool.',
    windy: 'Wind is strong at {windSpeed} m/s. Take a jacket.',
    rainy: 'Rain may come. Take an umbrella or raincoat.',
    weatherUnavailable: 'We picked a look you can wear any day. The forecast is missing.',
  },
  'es-419': {
    feels_like_adjusted:
      'Sensación térmica de {feelsLike}°C. Pensamos en {adjustedFeelsLike}°C para tu look.',
    feels_like_neutral: 'Sensación térmica de {feelsLike}°C.',
    cold: 'Usa un abrigo grueso.',
    chilly: 'Lleva una chaqueta.',
    mild: 'Usa capas ligeras.',
    warm: 'Prueba una blusa o camisa con pantalón, o un vestido.',
    hot: 'Usa ropa ligera para no pasar calor.',
    windy: 'El viento sopla fuerte a {windSpeed} m/s. Lleva una chaqueta.',
    rainy: 'Puede llover. Lleva un paraguas o un impermeable.',
    weatherUnavailable: 'Elegimos un look para cualquier día. Falta el pronóstico.',
  },
  'fr-CA': {
    feels_like_adjusted:
      'Température ressentie de {feelsLike}°C. On a choisi ta tenue pour {adjustedFeelsLike}°C.',
    feels_like_neutral: 'Température ressentie de {feelsLike}°C.',
    cold: 'Mets un manteau chaud.',
    chilly: 'Prends une veste.',
    mild: 'Mets des couches légères.',
    warm: 'Essaie un haut avec un pantalon ou une robe.',
    hot: 'Mets des vêtements légers pour rester au frais.',
    windy: 'Le vent souffle fort à {windSpeed} m/s. Prends une veste.',
    rainy: 'Il peut pleuvoir. Prends un parapluie ou un imperméable.',
    weatherUnavailable:
      'On a choisi une tenue de tous les jours. Les prévisions manquent.',
  },
  'fr-FR': {
    feels_like_adjusted:
      'Température ressentie de {feelsLike}°C. On a choisi ta tenue pour {adjustedFeelsLike}°C.',
    feels_like_neutral: 'Température ressentie de {feelsLike}°C.',
    cold: 'Mets un manteau chaud.',
    chilly: 'Prends une veste.',
    mild: 'Mets des couches légères.',
    warm: 'Essaie un haut avec un pantalon ou une robe.',
    hot: 'Mets des vêtements légers pour rester au frais.',
    windy: 'Le vent souffle fort à {windSpeed} m/s. Prends une veste.',
    rainy: 'Il peut pleuvoir. Prends un parapluie ou un imperméable.',
    weatherUnavailable:
      'On a choisi une tenue de tous les jours. Les prévisions manquent.',
  },
  'tr-TR': {
    feels_like_adjusted:
      'Hissedilen sıcaklık {feelsLike}°C. Senin için {adjustedFeelsLike}°C’ye uygun bir kombin seçtik.',
    feels_like_neutral: 'Hissedilen sıcaklık {feelsLike}°C.',
    cold: 'Kalın bir mont giy.',
    chilly: 'Bir ceket al.',
    mild: 'İnce katlar giy.',
    warm: 'Üst ve pantolon ya da elbise dene.',
    hot: 'Serin kalmak için ince giysiler giy.',
    windy: 'Rüzgâr {windSpeed} m/s hızla esiyor. Bir ceket al.',
    rainy: 'Yağmur yağabilir. Şemsiye ya da yağmurluk al.',
    weatherUnavailable: 'Her gün giyebileceğin bir kombin seçtik. Hava tahmini yok.',
  },
  'de-DE': {
    feels_like_adjusted:
      'Es fühlt sich an wie {feelsLike} °C. Dein Outfit passt zu {adjustedFeelsLike} °C.',
    feels_like_neutral: 'Es fühlt sich an wie {feelsLike} °C.',
    cold: 'Zieh einen warmen Mantel an.',
    chilly: 'Nimm eine Jacke mit.',
    mild: 'Zieh dünne Schichten an.',
    warm: 'Probier ein Oberteil mit Hose oder ein Kleid.',
    hot: 'Zieh leichte Sachen an. So bleibst du kühl.',
    windy: 'Der Wind weht stark mit {windSpeed} m/s. Nimm eine Jacke mit.',
    rainy: 'Es könnte regnen. Nimm einen Schirm oder eine Regenjacke mit.',
    weatherUnavailable:
      'Wir haben ein Outfit für jeden Tag ausgesucht. Die Vorhersage fehlt.',
  },
  'it-IT': {
    feels_like_adjusted:
      'Si sentono {feelsLike} °C. Abbiamo scelto un look per {adjustedFeelsLike} °C.',
    feels_like_neutral: 'Si sentono {feelsLike} °C.',
    cold: 'Metti un cappotto caldo.',
    chilly: 'Porta una giacca.',
    mild: 'Vestiti a strati leggeri.',
    warm: 'Prova una maglia con pantaloni o un vestito.',
    hot: 'Metti abiti leggeri per stare al fresco.',
    windy: 'Il vento soffia forte a {windSpeed} m/s. Porta una giacca.',
    rainy: 'Potrebbe piovere. Porta un ombrello o un impermeabile.',
    weatherUnavailable:
      'Abbiamo scelto un look di tutti i giorni. Mancano le previsioni.',
  },
  'pt-BR': {
    feels_like_adjusted:
      'A sensação é de {feelsLike} °C. Escolhemos um look para {adjustedFeelsLike} °C.',
    feels_like_neutral: 'A sensação é de {feelsLike} °C.',
    cold: 'Use um casaco quente.',
    chilly: 'Leve um casaco.',
    mild: 'Vista camadas leves.',
    warm: 'Experimente uma blusa com calça ou um vestido.',
    hot: 'Use roupas leves para ficar à vontade no calor.',
    windy: 'O vento está forte a {windSpeed} m/s. Leve um casaco.',
    rainy: 'Pode chover. Leve um guarda-chuva ou uma capa de chuva.',
    weatherUnavailable:
      'Escolhemos um look para o dia a dia. A previsão está indisponível.',
  },
  'pt-PT': {
    feels_like_adjusted:
      'A sensação é de {feelsLike} °C. Escolhemos roupa para {adjustedFeelsLike} °C.',
    feels_like_neutral: 'A sensação é de {feelsLike} °C.',
    cold: 'Veste um casaco quente.',
    chilly: 'Leva um casaco.',
    mild: 'Veste camadas leves.',
    warm: 'Experimenta uma camisola com calças ou um vestido.',
    hot: 'Veste roupa leve para te manteres fresco.',
    windy: 'O vento está forte a {windSpeed} m/s. Leva um casaco.',
    rainy: 'Pode chover. Leva um guarda-chuva ou um impermeável.',
    weatherUnavailable: 'Escolhemos roupa para o dia a dia. Falta a previsão.',
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
  { keyword: 'commute', key: 'commute_warmth', label: 'Morning layers' },
  { keyword: 'warmth', key: 'commute_warmth', label: 'Morning layers' },
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
      bullets: ['A jacket can block the wind.'],
    },
    rain_ready: {
      label: 'Rain-ready',
      bullets: ['Pack a raincoat or an umbrella.'],
    },
    evening_chill: {
      label: 'Evening chill',
      bullets: ['Wear a warm layer tonight.'],
    },
    commute_warmth: {
      label: 'Morning layers',
      bullets: ['Wear a warm layer this morning.'],
    },
    sun_protection: {
      label: 'Sun protection',
      bullets: ['Wear a hat in the sun.'],
    },
    light_layers: {
      label: 'Light layers',
      bullets: ['Wear light layers.'],
    },
    breathable_comfort: {
      label: 'Breathable comfort',
      bullets: ['Wear light clothes to stay cool.'],
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
      bullets: ['A jacket can block the wind.'],
    },
    rain_ready: {
      label: 'Rain-ready',
      bullets: ['Pack a raincoat or an umbrella.'],
    },
    evening_chill: {
      label: 'Evening chill',
      bullets: ['Wear a warm layer tonight.'],
    },
    commute_warmth: {
      label: 'Morning layers',
      bullets: ['Wear a warm layer this morning.'],
    },
    sun_protection: {
      label: 'Sun protection',
      bullets: ['Wear a hat in the sun.'],
    },
    light_layers: {
      label: 'Light layers',
      bullets: ['Wear light layers.'],
    },
    breathable_comfort: {
      label: 'Breathable comfort',
      bullets: ['Wear light clothes to stay cool.'],
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
      bullets: ['Lleva una chaqueta para el viento.'],
    },
    rain_ready: {
      label: 'Para lluvia',
      bullets: ['Lleva un impermeable o paraguas.'],
    },
    evening_chill: {
      label: 'Fresco nocturno',
      bullets: ['Abrígate esta noche.'],
    },
    commute_warmth: {
      label: 'Capas para la mañana',
      bullets: ['Ponte una capa abrigada esta mañana.'],
    },
    sun_protection: {
      label: 'Protección solar',
      bullets: ['Usa un sombrero al sol.'],
    },
    light_layers: {
      label: 'Capas ligeras',
      bullets: ['Usa capas ligeras.'],
    },
    breathable_comfort: {
      label: 'Comodidad transpirable',
      bullets: ['Usa ropa ligera para no pasar calor.'],
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
      bullets: ['Prends un coupe-vent.'],
    },
    rain_ready: {
      label: 'Prêt pour la pluie',
      bullets: ['Prends un imperméable ou un parapluie.'],
    },
    evening_chill: {
      label: 'Fraîcheur du soir',
      bullets: ['Mets une couche chaude ce soir.'],
    },
    commute_warmth: {
      label: 'Couches du matin',
      bullets: ['Mets une couche chaude ce matin.'],
    },
    sun_protection: {
      label: 'Protection solaire',
      bullets: ['Mets un chapeau au soleil.'],
    },
    light_layers: {
      label: 'Couches légères',
      bullets: ['Mets des couches légères.'],
    },
    breathable_comfort: {
      label: 'Confort respirant',
      bullets: ['Mets des vêtements légers pour rester au frais.'],
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
      bullets: ['Prends un coupe-vent.'],
    },
    rain_ready: {
      label: 'Prêt pour la pluie',
      bullets: ['Prends un imperméable ou un parapluie.'],
    },
    evening_chill: {
      label: 'Fraîcheur du soir',
      bullets: ['Mets une couche chaude ce soir.'],
    },
    commute_warmth: {
      label: 'Couches du matin',
      bullets: ['Mets une couche chaude ce matin.'],
    },
    sun_protection: {
      label: 'Protection solaire',
      bullets: ['Mets un chapeau au soleil.'],
    },
    light_layers: {
      label: 'Couches légères',
      bullets: ['Mets des couches légères.'],
    },
    breathable_comfort: {
      label: 'Confort respirant',
      bullets: ['Mets des vêtements légers pour rester au frais.'],
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
      bullets: ['Rüzgâr için bir ceket al.'],
    },
    rain_ready: {
      label: 'Yağmura hazırlık',
      bullets: ['Yağmurluk ya da şemsiye al.'],
    },
    evening_chill: {
      label: 'Akşam serinliği',
      bullets: ['Bu akşam kalın bir şey giy.'],
    },
    commute_warmth: {
      label: 'Sabah için katlar',
      bullets: ['Bu sabah üstüne kalın bir şey al.'],
    },
    sun_protection: {
      label: 'Güneş koruması',
      bullets: ['Güneşte şapka tak.'],
    },
    light_layers: {
      label: 'Hafif katmanlar',
      bullets: ['İnce katlar giy.'],
    },
    breathable_comfort: {
      label: 'Nefes alabilir konfor',
      bullets: ['Serin kalmak için ince giysiler giy.'],
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
      bullets: ['Nimm eine Jacke als Windschutz mit.'],
    },
    rain_ready: {
      label: 'Regenfest',
      bullets: ['Nimm eine Regenjacke oder einen Schirm mit.'],
    },
    evening_chill: {
      label: 'Abendkühle',
      bullets: ['Zieh heute Abend etwas Warmes an.'],
    },
    commute_warmth: {
      label: 'Schichten am Morgen',
      bullets: ['Zieh heute Morgen eine warme Schicht an.'],
    },
    sun_protection: {
      label: 'Sonnenschutz',
      bullets: ['Setz in der Sonne einen Hut auf.'],
    },
    light_layers: {
      label: 'Leichte Schichten',
      bullets: ['Zieh dünne Schichten an.'],
    },
    breathable_comfort: {
      label: 'Atmungsaktiver Komfort',
      bullets: ['Zieh leichte Sachen an. So bleibst du kühl.'],
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
      bullets: ['Porta una giacca per il vento.'],
    },
    rain_ready: {
      label: 'Pronto per la pioggia',
      bullets: ['Porta un impermeabile o un ombrello.'],
    },
    evening_chill: {
      label: 'Fresco serale',
      bullets: ['Vestiti al caldo stasera.'],
    },
    commute_warmth: {
      label: 'Strati per il mattino',
      bullets: ['Metti uno strato caldo stamattina.'],
    },
    sun_protection: {
      label: 'Protezione solare',
      bullets: ['Metti un cappello al sole.'],
    },
    light_layers: {
      label: 'Strati leggeri',
      bullets: ['Vestiti a strati leggeri.'],
    },
    breathable_comfort: {
      label: 'Comfort traspirante',
      bullets: ['Metti abiti leggeri per stare al fresco.'],
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
      bullets: ['Leve um casaco para o vento.'],
    },
    rain_ready: {
      label: 'Pronto para chuva',
      bullets: ['Leve uma capa de chuva ou um guarda-chuva.'],
    },
    evening_chill: {
      label: 'Frio da noite',
      bullets: ['Vista algo quente esta noite.'],
    },
    commute_warmth: {
      label: 'Camadas para a manhã',
      bullets: ['Vista uma camada quente nesta manhã.'],
    },
    sun_protection: {
      label: 'Proteção solar',
      bullets: ['Use um chapéu no sol.'],
    },
    light_layers: {
      label: 'Camadas leves',
      bullets: ['Vista camadas leves.'],
    },
    breathable_comfort: {
      label: 'Conforto respirável',
      bullets: ['Use roupas leves para se refrescar.'],
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
      bullets: ['Leva um casaco para o vento.'],
    },
    rain_ready: {
      label: 'Pronto para a chuva',
      bullets: ['Leva um impermeável ou um guarda-chuva.'],
    },
    evening_chill: {
      label: 'Frio da noite',
      bullets: ['Veste algo quente esta noite.'],
    },
    commute_warmth: {
      label: 'Camadas para a manhã',
      bullets: ['Veste uma camada quente esta manhã.'],
    },
    sun_protection: {
      label: 'Proteção solar',
      bullets: ['Usa um chapéu ao sol.'],
    },
    light_layers: {
      label: 'Camadas leves',
      bullets: ['Veste camadas leves.'],
    },
    breathable_comfort: {
      label: 'Conforto respirável',
      bullets: ['Veste roupa leve para te refrescares.'],
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

function refreshStoredBadgeCopy(key: string, bullet: string): string {
  // Older recommendations keep their original English evidence in storage.
  if (key === 'commute_warmth') {
    return bullet.replace(
      /^Morning feels-like temperature is (.*?), which is below the commute warmth threshold of 12°C\./,
      'It feels like $1 this morning. Wear a warm layer.'
    )
  }
  if (key === 'rain_ready') {
    return bullet
      .replace(
        /^Precipitation probability is \d+%, which exceeds your threshold of \d+%\./,
        'It may rain. Take a raincoat.'
      )
      .replace(
        /^Precipitation amount is [\d.]+ mm, which exceeds your threshold of [\d.]+ mm\./,
        'It may get wet. Take an umbrella.'
      )
  }
  return bullet
}

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
    localizeTemperatureTokens(refreshStoredBadgeCopy(key, bullet), locale)
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

function pickBestGarment(
  candidates: readonly GarmentItem[],
  targetComfortRange: ComfortRange,
  preferences: readonly GarmentSubtype[]
): GarmentItem | undefined {
  for (const range of [
    targetComfortRange,
    ...CLOSE_COMFORT_MATCHES[targetComfortRange],
  ]) {
    const tier = candidates.filter((garment) => garment.comfort_range === range)
    for (const subtype of preferences) {
      const match = tier.find((garment) => garment.subtype === subtype)
      if (match) return match
    }
    if (tier.length > 0) return tier[0]
  }

  return candidates[0]
}

type SubtypePreferences = Partial<
  Record<SampleGarmentCategory, readonly GarmentSubtype[]>
>

const coolSubtypePreferences = {
  outerwear: ['moto-jacket', 'blazer'],
  shoes: ['knee-boots', 'moto-boots', 'ankle-boots'],
  bottom: ['leggings'],
} as const satisfies SubtypePreferences

const warmSubtypePreferences = {
  top: ['camisole', 'tank', 'crop-top'],
  bottom: ['maxi-skirt', 'midi-skirt'],
} as const satisfies SubtypePreferences

function scenarioSubtypePreferences(
  weather: ScenarioWeatherInput,
  comfort: ComfortPreferencesInput
): SubtypePreferences {
  const input: SampleSelectionInput = {
    weather: 'mild-dry',
    collection: 'all',
    comfort,
    votes: {},
    swaps: {},
  }
  const context = buildSampleContext(input, weather)
  const { range } = context
  const preferences: SubtypePreferences =
    range === 'cold' || range === 'cool'
      ? { ...coolSubtypePreferences }
      : range === 'warm' || range === 'hot'
        ? { ...warmSubtypePreferences }
        : {}
  const sample = selectSampleOutfit(input, SAMPLE_CATALOG, undefined, context)
  for (const { category, subtype } of sample.garments) {
    if (!subtype) continue
    preferences[category] = [
      subtype,
      ...(preferences[category] ?? []).filter((candidate) => candidate !== subtype),
    ]
  }
  return preferences
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
  requiredCategories: readonly SampleGarmentCategory[],
  eligibleGarments: readonly GarmentItem[],
  targetComfortRange: ComfortRange,
  excludedGarmentIds: ReadonlySet<string> = new Set(),
  subtypePreferences: SubtypePreferences = {}
): { garmentIds: string[]; usedPlaceholder: boolean } {
  let usedPlaceholder = false

  const garmentIds = requiredCategories.map((category) => {
    const allCandidates = eligibleGarments.filter((g) => g.category === category)
    if (allCandidates.length === 0) {
      usedPlaceholder = true
      return `default-${category}`
    }

    const preferredCandidates = allCandidates.filter((g) => !excludedGarmentIds.has(g.id))
    const preferences = subtypePreferences[category] ?? []
    const chosen =
      pickBestGarment(preferredCandidates, targetComfortRange, preferences) ??
      pickBestGarment(allCandidates, targetComfortRange, preferences)
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
  const adjustedFeelsLike = adjustFeelsLike(weather.feelsLike, runsColdWarm)

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

  if (windExceeds(weather.windSpeed, windTolerance)) {
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

  const adjustedFeelsLike = adjustFeelsLike(weather.feelsLike, runsColdWarm)

  const capsuleEval = evaluateCapsuleForScenario({
    capsules: eligibleCapsules,
    userGarments: eligibleGarments,
    adjustedFeelsLike,
    requestedOccasion: occasion,
  })
  const recommendedCapsule = capsuleEval?.capsule

  let requiredCategories: SampleGarmentCategory[]
  if (needsOuterwear(adjustedFeelsLike)) {
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
    excludedGarmentIds,
    scenarioSubtypePreferences(weather, comfortPreferences)
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
  if (windExceeds(weather.windSpeed, windTolerance)) {
    const windSpeedFormatted = Math.round(weather.windSpeed * 10) / 10
    badgesList.push({
      key: 'wind_layer',
      label: 'Wind layer',
      bullets: withEvidenceSuffix(
        [
          `Wind is strong at ${windSpeedFormatted} m/s. Your wind limit is ${windThreshold} m/s.`,
        ],
        weather.source
      ),
    })
  }

  const probabilityExceeds = rainProbabilityExceeds(
    weather.precipitationProbability,
    precipPreparedness
  )
  const amountExceeds = rainAmountExceeds(weather.precipitationAmount, precipPreparedness)
  if (probabilityExceeds || amountExceeds) {
    const rainBullets: string[] = []
    if (probabilityExceeds) {
      rainBullets.push('It may rain. Take a raincoat.')
    }
    if (amountExceeds) {
      rainBullets.push('It may get wet. Take an umbrella.')
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
          `It feels like ${getFeelsLikeDesc(weather.feelsLike, adjustedFeelsLike)} tonight. Wear a warm layer.`,
        ],
        weather.source
      ),
    })
  }

  if (badgesList.length === 0) {
    if (weather.scenario === 'morning' && roundedAdjustedFeelsLike < 12) {
      badgesList.push({
        key: 'commute_warmth',
        label: 'Morning layers',
        bullets: withEvidenceSuffix(
          [
            `It feels like ${getFeelsLikeDesc(weather.feelsLike, adjustedFeelsLike)} this morning. Wear a warm layer.`,
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
            `It is sunny and feels like ${getFeelsLikeDesc(weather.feelsLike, adjustedFeelsLike)}. Take a hat.`,
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
            `It feels like ${getFeelsLikeDesc(weather.feelsLike, adjustedFeelsLike)}. Wear light layers.`,
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
            `It feels like ${getFeelsLikeDesc(weather.feelsLike, adjustedFeelsLike)}. Wear light clothes.`,
          ],
          weather.source
        ),
      })
    } else {
      badgesList.push({
        key: 'daily_base',
        label: 'Daily base',
        bullets: withEvidenceSuffix(
          [`It feels like ${getFeelsLikeDesc(weather.feelsLike, adjustedFeelsLike)}.`],
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

  const targetComfortRange: ComfortRange =
    comfortPreferences.runsColdWarm === 'cold'
      ? 'cool'
      : comfortPreferences.runsColdWarm === 'warm'
        ? 'warm'
        : 'mild'
  const hasDress = eligibleGarments.some((g) => g.category === 'dress')
  const requiredCategories: SampleGarmentCategory[] = hasDress
    ? ['dress', 'shoes']
    : ['top', 'bottom', 'shoes']
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
