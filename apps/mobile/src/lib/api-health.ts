import type { ApiHealthGet200Response, DefaultApi } from '@couture/api-client'
import { createMobileApiClient } from './api-client'

// Story 0.9 Task 7 step 5 owner:
// expose one mobile-friendly health helper so screens and tests consume the generated client surface.
type MobileHealthClient = Pick<DefaultApi, 'apiHealthGet'>

export async function loadMobileApiHealth(
  client: MobileHealthClient = createMobileApiClient()
): Promise<ApiHealthGet200Response> {
  return client.apiHealthGet()
}
