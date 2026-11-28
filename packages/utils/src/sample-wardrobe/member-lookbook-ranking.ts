import { z } from 'zod'
import { memberLookbookOutfitDraft, type createMemberLookbook } from './member-lookbook'
import type { SampleWeatherKey } from './selector'
import {
  activeStyleDay,
  styleSampleWeather,
  type StyleProfileAnswers,
  type StyleSampleInputs,
} from './style-profile'

const mixes = ['polished', 'simple', 'cozy', 'sporty', 'classic', 'casual', 'relaxed']
const weatherReasons = ['a cool day', 'a mild day', 'a warm day', 'a rainy day']

export const MEMBER_LOOKBOOK_DESCRIPTION_CHOICES = [
  ...mixes.map((mix) => `A ${mix} mix for the day.`),
  ...mixes.flatMap((mix) =>
    weatherReasons.map((reason) => `A ${mix} mix for ${reason}.`)
  ),
] as [string, ...string[]]

export const memberLookbookRankingSchema = z
  .array(
    z.strictObject({
      lookId: z
        .string()
        .max(100)
        .regex(/^sample:l:[a-z0-9-]+$/),
      description: z.enum(MEMBER_LOOKBOOK_DESCRIPTION_CHOICES),
    })
  )
  .length(3)

export type MemberLookbookRanking = z.infer<typeof memberLookbookRankingSchema>
export type MemberLookbookRankingInput = {
  weather: SampleWeatherKey
  profile: StyleProfileAnswers | null
}

type Ideas = ReturnType<typeof createMemberLookbook>

export function memberLookbookRankingInput(
  weather: SampleWeatherKey,
  { profile = null, day }: StyleSampleInputs
): MemberLookbookRankingInput {
  const override = activeStyleDay(day)
  return {
    weather: styleSampleWeather(weather, override?.temperature),
    profile: override?.mood
      ? {
          palette: null,
          texture: null,
          fit: null,
          avoid: [],
          ...profile,
          mood: override.mood,
        }
      : profile,
  }
}

export function memberLookbookRankingCandidates(ideas: Ideas) {
  return ideas.flatMap(({ result }) => {
    const { lookId, pieces } = memberLookbookOutfitDraft(result, [])
    return lookId ? [{ lookId, pieces }] : []
  })
}

export function validateMemberLookbookRanking(
  data: unknown,
  candidates: readonly { lookId: string }[],
  weather: SampleWeatherKey
): MemberLookbookRanking | null {
  const parsed = memberLookbookRankingSchema.safeParse(data)
  if (!parsed.success) return null

  const remaining = new Set(candidates.map(({ lookId }) => lookId))
  const [temperature] = weather.split('-')
  const describesWeather = (description: string) =>
    description.endsWith('for the day.') ||
    description.endsWith(`for a ${temperature} day.`) ||
    (weather.endsWith('-rainy') && description.endsWith('for a rainy day.'))

  return remaining.size === parsed.data.length &&
    parsed.data.every(
      ({ lookId, description }) =>
        remaining.delete(lookId) && describesWeather(description)
    )
    ? parsed.data
    : null
}

type RankingState = {
  key: string
  ranking: MemberLookbookRanking
  presentation: 'automatic' | 'pending' | 'applied'
}

export function createMemberLookbookRanking() {
  let edited = false
  let state: RankingState | null = null
  let active: AbortController | null = null
  const listeners = new Set<() => void>()
  const publish = (next: RankingState | null) => {
    state = next
    for (const notify of listeners) notify()
  }

  return {
    read: () => state,
    subscribe: (notify: () => void) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    markEdited: () => {
      edited = true
    },
    apply(expected: RankingState | null, isCurrent: () => boolean) {
      if (
        active &&
        isCurrent() &&
        state === expected &&
        expected?.presentation === 'pending'
      ) {
        publish({ ...expected, presentation: 'applied' })
      }
    },
    request(
      key: string,
      isCurrent: () => boolean,
      load: (signal: AbortSignal) => Promise<MemberLookbookRanking | null>
    ) {
      const request = new AbortController()
      active?.abort()
      active = request
      if (state) publish(null)
      if (isCurrent()) {
        void load(request.signal).then(
          (ranking) => {
            if (ranking && active === request && isCurrent()) {
              publish({ key, ranking, presentation: edited ? 'pending' : 'automatic' })
            }
          },
          () => undefined
        )
      }
      return () => {
        if (active === request) active = null
        request.abort()
      }
    },
  }
}

export function presentMemberLookbookRanking(
  ideas: Ideas,
  mood: Ideas[number]['mood'] | undefined,
  state: RankingState | null
) {
  const firstId = state?.presentation === 'automatic' ? state.ranking[0]?.lookId : null
  const selected =
    ideas.find((idea) => idea.mood === mood) ??
    ideas.find(({ result }) => result.look?.id === firstId) ??
    ideas[0]
  const pending = state?.presentation === 'pending'
  const description = pending
    ? undefined
    : state?.ranking.find(({ lookId }) => lookId === selected?.result.look?.id)
        ?.description
  const orderedIdeas =
    state && !pending
      ? state.ranking.flatMap(
          ({ lookId }) => ideas.find(({ result }) => result.look?.id === lookId) ?? []
        )
      : ideas
  return { selected, pending, description, orderedIdeas }
}
