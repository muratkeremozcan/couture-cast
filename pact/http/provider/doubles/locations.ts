import { NotFoundException } from '@nestjs/common'
import type { SavedLocation } from '@couture/api-client/contracts/http'
import {
  locationRequestError,
  locationUnavailableError,
} from '../../../../apps/api/src/modules/location-preferences/location-capture.errors'
import type { LocationCaptureService } from '../../../../apps/api/src/modules/location-preferences/location-capture.service'
import type { LocationPreferencesService } from '../../../../apps/api/src/modules/location-preferences/location-preferences.service'
import { getProviderLocationState } from '../state'

/**
 * Provider doubles for the Story 1.2b location surface. The real controller,
 * its validation and the real `RequestAuthGuard` run; only the two services are
 * replaced. Every identifier is mirrored in
 * `pact/http/consumer/interactions/locations.ts`.
 */
const CANDIDATE_TOKEN = 'pact-candidate-payload.pact-candidate-signature'
const CREATED_AT = '2026-10-22T12:00:00.000Z'
const PROVIDER_DOWN = 'The location provider is temporarily unavailable. Try again.'

const searched = (isPrimary: boolean): SavedLocation => ({
  id: 'loc-searched-1',
  label: 'Home',
  locationKey: 'chicago-illinois-us-41-878n-87-630w',
  latitude: 41.878,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  isPrimary,
  sortOrder: 0,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
})

const office = (isPrimary: boolean): SavedLocation => ({
  id: 'loc-office-2',
  label: 'Office',
  locationKey: 'monaco-mc-43-738n-7-425e',
  latitude: 43.738,
  longitude: 7.425,
  timezone: 'Europe/Monaco',
  city: 'Monaco',
  region: null,
  country: 'MC',
  isPrimary,
  sortOrder: 1,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
})

function scenario() {
  const state = getProviderLocationState()
  if (!state) throw new NotFoundException('LOCATION_STATE_NOT_CONFIGURED')
  return state.scenario
}

export function createLocationDoubles() {
  const mockLocationPreferencesService = {
    listLocations: () =>
      Promise.resolve(
        scenario() === 'two-locations' ? [searched(true), office(false)] : []
      ),
    setPrimary: (_userId: string, locationId: string) => {
      if (scenario() === 'two-locations' && locationId === 'loc-office-2') {
        return Promise.resolve(office(true))
      }
      return Promise.reject(new NotFoundException('Saved location not found'))
    },
    deleteLocation: (_userId: string, locationId: string) => {
      if (scenario() === 'two-locations' && locationId === 'loc-searched-1') {
        return Promise.resolve({ deleted: true as const })
      }
      return Promise.reject(new NotFoundException('Saved location not found'))
    },
  } as unknown as LocationPreferencesService

  const mockLocationCaptureService = {
    search: () => {
      if (scenario() === 'provider-unavailable') {
        return Promise.reject(
          locationUnavailableError('provider_unavailable', PROVIDER_DOWN)
        )
      }
      return Promise.resolve([
        {
          city: 'Chicago',
          region: 'Illinois',
          country: 'US',
          latitude: 41.878,
          longitude: -87.63,
          displayLabel: 'Chicago, Illinois, États-Unis',
          candidateToken: CANDIDATE_TOKEN,
        },
      ])
    },
    saveFromSearch: (_userId: string, candidateToken: string) => {
      const current = scenario()
      if (current === 'provider-unavailable') {
        return Promise.reject(
          locationUnavailableError('provider_unavailable', PROVIDER_DOWN)
        )
      }
      if (current === 'three-locations') {
        return Promise.reject(
          locationRequestError(
            'location_limit_reached',
            'Users can save at most three locations'
          )
        )
      }
      if (current === 'expired-candidate' || candidateToken !== CANDIDATE_TOKEN) {
        return Promise.reject(
          locationRequestError(
            'invalid_candidate',
            'This search result expired. Search again.'
          )
        )
      }
      return Promise.resolve(searched(true))
    },
  } as unknown as LocationCaptureService

  return { mockLocationPreferencesService, mockLocationCaptureService }
}
