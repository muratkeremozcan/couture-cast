import { resolveComfortRangeFromTemperature } from '../comfort-rules'
import { SAMPLE_CATALOG } from './catalog'
import type { SampleSelectionInput, SampleWeatherKey } from './selector'
import {
  SAMPLE_STYLE_OPTIONS,
  type SampleGarment,
  type SampleStylePreferences,
} from './types'

export const STYLE_AVOID_OPTIONS = ['crop-top', 'mini-skirt', 'leggings'] as const
export const STYLE_TEMPERATURE_OPTIONS = ['cool', 'mild', 'warm'] as const
export type StyleMood = NonNullable<SampleStylePreferences['style']>
export type StyleAvoid = (typeof STYLE_AVOID_OPTIONS)[number]
export type StyleTemperature = (typeof STYLE_TEMPERATURE_OPTIONS)[number]
export type StyleProfileAnswers = {
  mood: StyleMood | null
  palette: NonNullable<SampleStylePreferences['palette']> | null
  texture: NonNullable<SampleStylePreferences['texture']> | null
  fit: NonNullable<SampleStylePreferences['fit']> | null
  avoid: StyleAvoid[]
}
export type StyleDay = {
  date: string
  temperature?: StyleTemperature
  mood?: StyleMood
}
export type StyleSampleInputs = {
  profile?: StyleProfileAnswers | null
  day?: StyleDay | null
}

export function styleLocalDay(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function activeStyleDay(
  record?: StyleDay | null,
  now = new Date()
): StyleDay | null {
  return record?.date === styleLocalDay(now) ? record : null
}

function hasStyleProfileAnswers(profile: StyleProfileAnswers | null): boolean {
  return Boolean(
    profile &&
      (profile.mood ||
        profile.palette ||
        profile.texture ||
        profile.fit ||
        profile.avoid.length)
  )
}

export function shouldShowStyleSample(
  outfits: readonly { garmentIds: readonly string[] }[] | undefined,
  { profile, day }: StyleSampleInputs
): boolean {
  if (activeStyleDay(day) || !outfits?.some(({ garmentIds }) => garmentIds.length > 0))
    return true
  return (
    hasStyleProfileAnswers(profile ?? null) &&
    !outfits.some(({ garmentIds }) => garmentIds.some((id) => !id.startsWith('default-')))
  )
}

export function styleProfileSelection(
  profile?: StyleProfileAnswers | null,
  day?: StyleDay | null
): Pick<SampleSelectionInput, 'preferences' | 'avoid'> {
  const style = day?.mood ?? profile?.mood
  const palette = profile?.palette
  const texture = profile?.texture
  const fit = profile?.fit
  return {
    ...(style || palette || texture || fit
      ? {
          preferences: {
            ...(style && { style }),
            ...(palette && { palette }),
            ...(texture && { texture }),
            ...(fit && { fit }),
          },
        }
      : {}),
    ...(profile?.avoid.length ? { avoid: profile.avoid } : {}),
  }
}

const sampleWeatherByTemperature = {
  cool: { dry: 'cool-windy', rainy: 'cool-rainy' },
  mild: { dry: 'mild-dry', rainy: 'mild-rainy' },
  warm: { dry: 'warm-dry', rainy: 'warm-rainy' },
} as const satisfies Record<StyleTemperature, Record<'dry' | 'rainy', SampleWeatherKey>>

export function styleSampleWeather(
  weather: SampleWeatherKey,
  temperature?: StyleTemperature
): SampleWeatherKey {
  const wetness = weather.endsWith('rainy') ? 'rainy' : 'dry'
  return temperature ? sampleWeatherByTemperature[temperature][wetness] : weather
}

export function styleForecastSampleWeather(
  current?: { temperature: number; condition: string } | null
): SampleWeatherKey {
  if (!current) return 'mild-dry'
  const range = resolveComfortRangeFromTemperature(current.temperature)
  const temperature =
    range === 'cold' || range === 'cool' ? 'cool' : range === 'mild' ? 'mild' : 'warm'
  const wet = ['drizzle', 'rain', 'sleet', 'snow', 'thunderstorm'].includes(
    current.condition
  )
  return sampleWeatherByTemperature[temperature][wet ? 'rainy' : 'dry']
}

const illustrationIds = {
  active: 'polo-shirt',
  chic: 'silk-blouse',
  cozy: 'cable-knit',
  classic: 'oxford-shirt',
  smooth: 'camisole',
  textured: 'ribbed-knit',
  fitted: 'wool-trousers',
  relaxed: 'linen-trousers',
  'crop-top': 'crop-top',
  'mini-skirt': 'mini-skirt',
  leggings: 'leggings',
} as const satisfies Record<
  StyleMood | StyleAvoid | 'smooth' | 'textured' | 'fitted' | 'relaxed',
  string
>

export type StyleIllustratedChoice = keyof typeof illustrationIds

export function styleChoiceGarment(choice: StyleIllustratedChoice): SampleGarment {
  return SAMPLE_CATALOG.garments.find(
    ({ id }) => id === `sample:g:${illustrationIds[choice]}`
  )!
}

export const STYLE_PALETTE_SWATCHES = {
  neutral: ['#f3e9da', '#bc9a74', '#45424b'],
  colorful: ['#ab5384', '#297c78', '#ecb040'],
} as const satisfies Record<
  (typeof SAMPLE_STYLE_OPTIONS.palette)[number],
  readonly string[]
>

export const STYLE_TUNE_GROUPS = {
  palette: SAMPLE_STYLE_OPTIONS.palette,
  texture: SAMPLE_STYLE_OPTIONS.texture,
  fit: SAMPLE_STYLE_OPTIONS.fit,
  avoid: STYLE_AVOID_OPTIONS,
} as const

export const STYLE_TUNE_STEPS = [['palette'], ['texture', 'fit'], ['avoid']] as const
export type StyleTuneGroup = keyof typeof STYLE_TUNE_GROUPS
export type StyleTuneChoice = (typeof STYLE_TUNE_GROUPS)[StyleTuneGroup][number]

export function toggleStyleTuneChoice(
  draft: StyleProfileAnswers,
  group: StyleTuneGroup,
  choice: StyleTuneChoice
): StyleProfileAnswers {
  if (group === 'avoid') {
    const piece = choice as StyleAvoid
    const avoid = draft.avoid.includes(piece)
      ? draft.avoid.filter((value) => value !== piece)
      : [...draft.avoid, piece]
    return { ...draft, avoid }
  }
  return { ...draft, [group]: draft[group] === choice ? null : choice }
}

export function styleTuneSelected(
  draft: StyleProfileAnswers,
  group: StyleTuneGroup,
  choice: StyleTuneChoice
): boolean {
  return group === 'avoid'
    ? draft.avoid.includes(choice as StyleAvoid)
    : draft[group] === choice
}

export function styleTunePatch(
  draft: StyleProfileAnswers,
  step: number
): Partial<StyleProfileAnswers> {
  const { palette, texture, fit, avoid } = draft
  if (step === 0) return { palette }
  if (step === 1) return { texture, fit }
  return { avoid }
}
