// Story 1.2b: API-shaped saved-location data and the error envelopes the
// location and ritual routes answer with, shared by the Locations, hero and
// Community suites. `@couture/testing`'s saved-location factory is the Prisma
// row (Date fields, userId); these are the HTTP contract shapes the clients parse.
import { HttpResponse } from 'msw'
import type {
  LocationRequestErrorCode,
  LocationSearchCandidate,
  LocationUnavailableErrorCode,
  SavedLocation,
} from '@couture/api-client/contracts/http'

/** The primary Chicago location; override any field. */
export function savedLocation(overrides: Partial<SavedLocation> = {}): SavedLocation {
  return {
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
    ...overrides,
  }
}

/** A second, non-primary location with no region (Monaco). */
export function officeLocation(overrides: Partial<SavedLocation> = {}): SavedLocation {
  return savedLocation({
    id: 'loc-2',
    label: 'Office',
    locationKey: 'monaco-mc-43-738n-7-425e',
    latitude: 43.738,
    longitude: 7.425,
    timezone: 'Europe/Monaco',
    city: 'Monaco',
    region: null,
    country: 'MC',
    isPrimary: false,
    sortOrder: 1,
    ...overrides,
  })
}

export function locationCandidate(
  overrides: Partial<LocationSearchCandidate> = {}
): LocationSearchCandidate {
  return {
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
    latitude: 41.878,
    longitude: -87.63,
    displayLabel: 'Chicago, Illinois, United States',
    candidateToken: 'candidate-payload.candidate-signature',
    ...overrides,
  }
}

/** The Nest envelope `GET /ritual` answers for a member with no saved location. */
export function noLocationEnvelope() {
  return {
    message: 'No location preferences found for user',
    error: 'Bad Request',
    statusCode: 400,
  }
}

export function noLocationResponse() {
  return HttpResponse.json(noLocationEnvelope(), { status: 400 })
}

/** A coded 400 from the location routes. */
export function locationRequestErrorResponse(code: LocationRequestErrorCode) {
  return HttpResponse.json(
    { statusCode: 400, code, message: code, error: 'Bad Request' },
    { status: 400 }
  )
}

/** A retryable 503 from the location routes. */
export function locationUnavailableResponse(
  code: LocationUnavailableErrorCode = 'provider_unavailable'
) {
  return HttpResponse.json(
    {
      statusCode: 503,
      code,
      retryable: true,
      message: 'down',
      error: 'Service Unavailable',
    },
    { status: 503 }
  )
}
