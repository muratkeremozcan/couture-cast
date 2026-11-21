import { ResponseError, withRequestDeadline } from '@couture/api-client'
import {
  resolveSupportedLocale,
  ritualResponseSchema,
} from '@couture/api-client/contracts/http'
import { createWebApiClient } from './api-client'

export const SET_CITY_FROM_HOME = '/settings?addLocation=1&returnTo=%2F#locations'
export const SET_CITY_FROM_PLANNER =
  '/settings?addLocation=1&returnTo=%2F%3Fplanner%3D1#locations'

export async function getRitualFromWeb(
  token: string,
  locale: string,
  signal: AbortSignal
) {
  const api = createWebApiClient({ accessToken: token })
  const response = await withRequestDeadline(16_000, [signal], (requestSignal) =>
    api.apiV1RitualGet(
      { locale: resolveSupportedLocale(locale) ?? 'en-US' },
      { signal: requestSignal }
    )
  )
  return ritualResponseSchema.parse(response).data
}

export async function ritualFailure(error: unknown): Promise<'missing-city' | 'failed'> {
  if (error instanceof ResponseError && error.response.status === 400) {
    const body: unknown = await error.response.json().catch(() => null)
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      body.message === 'No location preferences found for user'
    )
      return 'missing-city'
  }
  return 'failed'
}
