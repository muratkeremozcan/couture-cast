// Story 1.2b: the web location transport. Every failure reaches the UI as one
// `LocationFailureReason`, so this pins the mapping from each HTTP answer.
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type { SavedLocation } from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  deleteLocationFromWeb,
  listLocationsFromWeb,
  LocationRequestError,
  renameLocationFromWeb,
  saveLocationFromSearchFromWeb,
  searchLocationsFromWeb,
  setPrimaryLocationFromWeb,
} from './locations'

const location: SavedLocation = {
  id: 'loc-1',
  label: 'Home',
  locationKey: 'chicago-illinois-us-41-878n-87-630w',
  latitude: 41.878,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-10-22T12:00:00.000Z',
  updatedAt: '2026-10-22T12:00:00.000Z',
}

afterEach(() => {
  window.sessionStorage.clear()
})

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

async function reasonOf(work: Promise<unknown>): Promise<string> {
  const caught = await work.catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(LocationRequestError)
  return (caught as LocationRequestError).reason
}

describe('web location transport', () => {
  it('1.2b-WEB-LIB-01 refuses every call while signed out, before any request', async () => {
    await expect(reasonOf(listLocationsFromWeb())).resolves.toBe('signed_out')
  })

  it('1.2b-WEB-LIB-02 sends the web platform and parses each success', async () => {
    signIn()
    const platforms: (string | null)[] = []
    useMswHandlers(
      http.get('*/api/v1/locations', () => HttpResponse.json({ data: [location] })),
      http.get('*/api/v1/locations/search', ({ request }) => {
        platforms.push(request.headers.get('x-couture-platform'))
        return HttpResponse.json({
          data: [
            {
              city: 'Chicago',
              region: 'Illinois',
              country: 'US',
              latitude: 41.878,
              longitude: -87.63,
              displayLabel: 'Chicago, Illinois, United States',
              candidateToken: 'payload.signature',
            },
          ],
        })
      }),
      http.post('*/api/v1/locations/from-search', ({ request }) => {
        platforms.push(request.headers.get('x-couture-platform'))
        return HttpResponse.json({ data: location }, { status: 201 })
      }),
      http.post('*/api/v1/locations/loc-1/primary', () =>
        HttpResponse.json({ data: location })
      ),
      http.patch('*/api/v1/locations/loc-1', () =>
        HttpResponse.json({ data: { ...location, label: 'Office' } })
      ),
      http.delete('*/api/v1/locations/loc-1', () =>
        HttpResponse.json({ data: { deleted: true } })
      )
    )

    await expect(listLocationsFromWeb()).resolves.toEqual([location])
    await expect(searchLocationsFromWeb('Chicago', 'en-US')).resolves.toHaveLength(1)
    await expect(
      saveLocationFromSearchFromWeb('payload.signature', 'Home')
    ).resolves.toEqual(location)
    await expect(setPrimaryLocationFromWeb('loc-1')).resolves.toEqual(location)
    await expect(renameLocationFromWeb('loc-1', 'Office')).resolves.toMatchObject({
      label: 'Office',
    })
    await expect(deleteLocationFromWeb('loc-1')).resolves.toBeUndefined()
    expect(platforms).toEqual(['web', 'web'])
  })

  it.each([
    [401, { message: 'Unauthorized' }, 'signed_out'],
    [404, { message: 'Not Found' }, 'not_found'],
    [429, { message: 'Too Many Requests' }, 'rate_limited'],
    [
      400,
      { statusCode: 400, code: 'invalid_request', message: 'q', error: 'Bad Request' },
      'invalid_query',
    ],
    [
      400,
      { statusCode: 400, code: 'invalid_candidate', message: 'x', error: 'Bad Request' },
      'invalid_candidate',
    ],
    [
      400,
      {
        statusCode: 400,
        code: 'location_limit_reached',
        message: 'x',
        error: 'Bad Request',
      },
      'limit_reached',
    ],
    [
      400,
      { statusCode: 400, code: 'location_duplicate', message: 'x', error: 'Bad Request' },
      'duplicate',
    ],
    [
      503,
      {
        statusCode: 503,
        code: 'provider_unavailable',
        retryable: true,
        message: 'x',
        error: 'Service Unavailable',
      },
      'provider_unavailable',
    ],
    [
      503,
      {
        statusCode: 503,
        code: 'location_service_unavailable',
        retryable: true,
        message: 'x',
        error: 'Service Unavailable',
      },
      'service_unavailable',
    ],
    // The legacy location routes answer the plain Nest 400.
    [400, { statusCode: 400, message: 'bad', error: 'Bad Request' }, 'invalid_query'],
    [500, { statusCode: 500, message: 'boom' }, 'unknown'],
  ])('1.2b-WEB-LIB-03 maps HTTP %i %j to %s', async (status, body, reason) => {
    signIn()
    useMswHandlers(
      http.post('*/api/v1/locations/from-search', () =>
        HttpResponse.json(body, { status })
      )
    )

    await expect(
      reasonOf(saveLocationFromSearchFromWeb('payload.signature', 'Home'))
    ).resolves.toBe(reason)
  })

  it('1.2b-WEB-LIB-04 maps a body that is not JSON and a dropped connection to unknown', async () => {
    signIn()
    useMswHandlers(
      http.post(
        '*/api/v1/locations/from-search',
        () => new HttpResponse('<html>gateway</html>', { status: 502 })
      ),
      http.get('*/api/v1/locations', () => HttpResponse.error())
    )

    await expect(
      reasonOf(saveLocationFromSearchFromWeb('payload.signature', 'Home'))
    ).resolves.toBe('unknown')
    await expect(reasonOf(listLocationsFromWeb())).resolves.toBe('unknown')
  })

  it('1.2b-WEB-LIB-05 lets an aborted search reject as an abort, never as a failure', async () => {
    signIn()
    useMswHandlers(
      http.get('*/api/v1/locations/search', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return HttpResponse.json({ data: [] })
      })
    )
    const controller = new AbortController()
    const pending = searchLocationsFromWeb('Chicago', 'en-US', controller.signal)
    controller.abort()

    const caught = await pending.catch((error: unknown) => error)
    expect(caught).not.toBeInstanceOf(LocationRequestError)
    expect((caught as Error).name).toBe('AbortError')
  })
})
