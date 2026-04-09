import type {
  DefaultApi,
  EventsPollInvalidSinceResponse,
  EventsPollResponse,
} from '@couture/api-client'
import { createWebApiClient } from './api-client'

// Story 0.9 Task 7 step 3 owner:
// route web polling through the generated client instead of rebuilding request details in components.
type WebEventsClient = Pick<DefaultApi, 'apiV1EventsPollGetRaw'>

export type WebEventsPollResponse = EventsPollResponse | EventsPollInvalidSinceResponse

export async function pollWebEvents(
  since?: string,
  client: WebEventsClient = createWebApiClient()
): Promise<WebEventsPollResponse> {
  const response = await client.apiV1EventsPollGetRaw(since ? { since } : {})

  return (await response.raw.json()) as WebEventsPollResponse
}
