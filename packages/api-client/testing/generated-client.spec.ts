import type { Configuration } from '../src'
import { expect, test } from 'vitest'
import { DefaultApi, createApiClient } from '../src'

// Story 0.9 Task 3 step 5 owner:
// prove that the package root exports produce the wrapped generated client shape we intend to ship.
test('creates a generated DefaultApi client from the root export surface', () => {
  const client = createApiClient('https://api.couturecast.test', 'token-123')
  const configuration = (client as unknown as { configuration: Configuration })
    .configuration

  expect(client).toBeInstanceOf(DefaultApi)
  expect(configuration.basePath).toBe('https://api.couturecast.test')
  expect(typeof configuration.accessToken).toBe('function')
})

test('accepts configuration overrides through the stable wrapper surface', async () => {
  const client = createApiClient('https://api.couturecast.test', {
    accessToken: () => 'token-456',
    credentials: 'include',
    headers: {
      'x-couture-surface': 'web',
    },
  })
  const configuration = (client as unknown as { configuration: Configuration })
    .configuration

  expect(client).toBeInstanceOf(DefaultApi)
  expect(configuration.basePath).toBe('https://api.couturecast.test')
  expect(configuration.credentials).toBe('include')
  expect(configuration.headers).toEqual({
    'x-couture-surface': 'web',
  })
  expect(await configuration.accessToken?.()).toBe('token-456')
})

test('applies accessToken to authenticated generated weather requests', async () => {
  const client = createApiClient('https://api.couturecast.test', 'token-789')

  const requestOptions = await client.apiV1WeatherLocationKeyGetRequestOpts({
    locationKey: 'new-york-ny',
  })

  expect(requestOptions.headers).toMatchObject({
    Authorization: 'Bearer token-789',
  })
})

test('applies accessToken to authenticated event polling requests', async () => {
  const client = createApiClient('https://api.couturecast.test', 'token-events')

  const requestOptions = await client.apiV1EventsPollGetRequestOpts({})

  expect(requestOptions.headers).toMatchObject({
    Authorization: 'Bearer token-events',
  })
})

test('generates authenticated alert preference and rule requests', async () => {
  const client = createApiClient('https://api.couturecast.test', 'token-alerts')

  const getOptions = await client.apiV1AlertsPreferencesGetRequestOpts()
  const preferencesOptions = await client.apiV1AlertsPreferencesPutRequestOpts({
    updateNotificationPreferencesInput: {
      quietHoursEnabled: true,
      pushEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/Chicago',
    },
  })
  const rulesOptions = await client.apiV1AlertsRulesPutRequestOpts({
    updateAlertRulesInput: {
      rules: [
        {
          ruleType: 'temperature',
          threshold: 5,
          enabled: true,
        },
      ],
    },
  })

  for (const requestOptions of [getOptions, preferencesOptions, rulesOptions]) {
    expect(requestOptions.headers).toMatchObject({
      Authorization: 'Bearer token-alerts',
    })
  }

  expect(preferencesOptions).toMatchObject({
    method: 'PUT',
    path: '/api/v1/alerts/preferences',
  })
  expect(rulesOptions).toMatchObject({
    method: 'PUT',
    path: '/api/v1/alerts/rules',
  })
})
