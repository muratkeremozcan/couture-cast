import type { DefaultApi } from '@couture/api-client'
import {
  alertPreferencesSchema,
  type AlertPreferences,
} from '@couture/api-client/contracts/http'

export async function loadWidgetAlertPreferences(
  client: DefaultApi,
  signal?: AbortSignal
): Promise<AlertPreferences | undefined> {
  try {
    const response = await client.apiV1AlertsPreferencesGet(
      signal ? { signal } : undefined
    )
    return alertPreferencesSchema.parse(response.data.preferences)
  } catch {
    // Alert delivery fails closed when preferences cannot be verified.
    return undefined
  }
}
