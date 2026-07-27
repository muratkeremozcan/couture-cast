import { describe, expect, it, vi } from 'vitest'
import type { DefaultApi } from '@couture/api-client'
import { loadWidgetAlertPreferences } from './widget-alert-preferences'

describe('widget alert preferences', () => {
  it('parses the canonical alert preference response', async () => {
    const apiV1AlertsPreferencesGet = vi.fn().mockResolvedValue({
      data: {
        preferences: {
          pushEnabled: true,
          quietHoursEnabled: true,
          quietHoursStart: '21:30',
          quietHoursEnd: '06:15',
          timezone: 'America/Chicago',
        },
        rules: [],
      },
    })
    const client = { apiV1AlertsPreferencesGet } as unknown as DefaultApi

    await expect(loadWidgetAlertPreferences(client)).resolves.toEqual({
      pushEnabled: true,
      quietHoursEnabled: true,
      quietHoursStart: '21:30',
      quietHoursEnd: '06:15',
      timezone: 'America/Chicago',
    })
  })

  it('fails closed when preferences cannot be loaded or validated', async () => {
    const unavailableClient = {
      apiV1AlertsPreferencesGet: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as DefaultApi
    const invalidClient = {
      apiV1AlertsPreferencesGet: vi.fn().mockResolvedValue({
        data: { preferences: { pushEnabled: true }, rules: [] },
      }),
    } as unknown as DefaultApi

    await expect(loadWidgetAlertPreferences(unavailableClient)).resolves.toBeUndefined()
    await expect(loadWidgetAlertPreferences(invalidClient)).resolves.toBeUndefined()
  })
})
