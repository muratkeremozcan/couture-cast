import type {
  DefaultApi,
  EventsPollInvalidSinceResponse,
  EventsPollResponse,
} from '@couture/api-client'
import { createWebApiClient } from './api-client'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

// Story 0.9 Task 7 step 3 owner:
// route web polling through the generated client instead of rebuilding request details in components.
type WebEventsClient = Pick<DefaultApi, 'apiV1EventsPollGetRaw'>

export type WebEventsPollResponse = EventsPollResponse | EventsPollInvalidSinceResponse

export const WEB_EVENTS_SIGNED_OUT_MESSAGE = 'Sign in to read events.'

/** The bearer this browser holds right now, or null when nobody is signed in. */
export function readWebEventsAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  return window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() || null
}

/**
 * The events feed is per account behind `RequestAuthGuard`, so the client reads
 * the bearer when each request goes out. A token refresh or an account switch
 * between two polls is picked up without rebuilding the client, and a poll with
 * nobody signed in fails before it reaches the network.
 */
export function createWebEventsClient(): WebEventsClient {
  return createWebApiClient({
    accessToken: () => {
      const token = readWebEventsAccessToken()
      if (!token) {
        throw new Error(WEB_EVENTS_SIGNED_OUT_MESSAGE)
      }
      return token
    },
  })
}

export async function pollWebEvents(
  since?: string,
  client: WebEventsClient = createWebEventsClient(),
  signal?: AbortSignal
): Promise<WebEventsPollResponse> {
  const response = await client.apiV1EventsPollGetRaw(
    since ? { since } : {},
    signal ? { signal } : undefined
  )

  return (await response.raw.json()) as WebEventsPollResponse
}
