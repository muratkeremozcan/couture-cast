import { test, expect } from '../../support/fixtures/merged-fixtures'
import { resolveApiBaseUrl } from '../../support/helpers/api-test'
import {
  eventsPollInvalidSinceResponseSchema,
  eventsPollResponseSchema,
} from '@couture/api-client/contracts/http'

process.env.API_E2E_UI_MODE = 'true'

const POLL_PATH = '/api/v1/events/poll'

type TypedResponse = {
  status: number
  body: { events: unknown[]; nextSince: string | null; error?: string }
}

test.describe('Realtime poll API', () => {
  test('[P1] poll returns events array and nextSince shape', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_POLL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    const { status, body } = (await apiRequest({
      method: 'GET',
      path: POLL_PATH,
      baseUrl,
    })) as TypedResponse
    expect(status).toBe(200)

    await validateSchema(eventsPollResponseSchema, body)
    expect(Array.isArray(body.events)).toBe(true)
    expect(typeof body.nextSince === 'string' || body.nextSince === null).toBe(true)
  })

  test('[P2] poll rejects invalid since timestamp', async ({
    apiRequest,
    validateSchema,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, {
      overrideEnvVar: 'LIVE_POLL_BASE_URL',
      fallback: 'http://localhost:4000',
    })

    const pollUrl = `${POLL_PATH}?since=not-a-date`

    const { status, body } = (await apiRequest({
      method: 'GET',
      path: pollUrl,
      baseUrl,
    })) as TypedResponse
    expect(status).toBe(200)

    await validateSchema(eventsPollInvalidSinceResponseSchema, body)
    expect(body.events).toEqual([])
    expect(body.nextSince).toBeNull()
    expect(body.error).toBe('Invalid since timestamp')
  })
})
