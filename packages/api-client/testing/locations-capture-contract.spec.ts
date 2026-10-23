import { describe, expect, it } from 'vitest'
import {
  createSavedLocationFromSearchInputSchema,
  createSavedLocationFromSearchResponseSchema,
  listSavedLocationsResponseSchema,
  locationRequestErrorResponseSchema,
  locationSearchQueryParamsSchema,
  locationSearchResponseSchema,
  locationUnavailableResponseSchema,
} from '../src/contracts/http/locations'

// Story 1.2b: an installed mobile build parses these bodies with the schemas it
// shipped with, so a field the server adds later must parse (and be dropped),
// never fail. What the client sends stays strict.
const savedLocation = {
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

const candidate = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.878,
  longitude: -87.63,
  displayLabel: 'Chicago, Illinois, United States',
  candidateToken: 'payload.signature',
}

describe('location contract compatibility', () => {
  it.each([
    [
      'search results',
      locationSearchResponseSchema,
      { data: [{ ...candidate, timezoneHint: 'America/Chicago' }], page: 1 },
    ],
    [
      'a saved location',
      createSavedLocationFromSearchResponseSchema,
      { data: { ...savedLocation, weatherReady: true } },
    ],
    [
      'the saved list',
      listSavedLocationsResponseSchema,
      { data: [{ ...savedLocation, weatherReady: true }] },
    ],
    [
      'a typed 400',
      locationRequestErrorResponseSchema,
      {
        statusCode: 400,
        code: 'location_duplicate',
        message: 'That location is already saved.',
        error: 'Bad Request',
        requestId: 'req-1',
      },
    ],
    [
      'a typed 503',
      locationUnavailableResponseSchema,
      {
        statusCode: 503,
        code: 'provider_unavailable',
        retryable: true,
        message: 'down',
        error: 'Service Unavailable',
        retryAfterSeconds: 5,
      },
    ],
  ])(
    '1.2b-UNIT-CONTRACT-01 parses %s that carry an added field and drops it',
    (_name, schema, body) => {
      const parsed = schema.safeParse(body)
      expect(parsed.success).toBe(true)
      expect(JSON.stringify(parsed.data)).not.toMatch(
        /timezoneHint|weatherReady|requestId|retryAfterSeconds|"page"/
      )
    }
  )

  it('1.2b-UNIT-CONTRACT-02 keeps request bodies and query strict', () => {
    expect(
      createSavedLocationFromSearchInputSchema.safeParse({
        candidateToken: 'payload.signature',
        label: 'Home',
        userId: 'someone-else',
      }).success
    ).toBe(false)
    expect(
      locationSearchQueryParamsSchema.safeParse({ q: 'Chicago', lat: 41 }).success
    ).toBe(false)
  })
})
