import { expect, test } from 'vitest'
import {
  createSavedLocationInputSchema,
  createSavedLocationResponseSchema,
  deleteSavedLocationResponseSchema,
  findSavedSearchLocation,
  generateHttpOpenApiDocument,
  listSavedLocationsResponseSchema,
  savedLocationSchema,
  setPrimarySavedLocationResponseSchema,
  updateSavedLocationInputSchema,
} from '../src/contracts/http'

const savedLocation = {
  id: 'loc_123',
  label: 'Office',
  locationKey: 'chicago-il',
  latitude: 41.878,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'IL',
  country: 'US',
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-07-09T12:00:00.000Z',
  updatedAt: '2026-07-09T12:00:00.000Z',
}

test('recovers the submitted location by coordinates, country and submitted label', () => {
  const candidate = {
    city: savedLocation.city,
    region: savedLocation.region,
    country: savedLocation.country,
    latitude: savedLocation.latitude,
    longitude: savedLocation.longitude,
    displayLabel: 'Chicago, Illinois, United States',
    candidateToken: 'fixture',
  }
  const differentPlaces = [
    { ...savedLocation, country: 'CA' },
    { ...savedLocation, latitude: 42 },
    { ...savedLocation, longitude: -88 },
    { ...savedLocation, label: 'Home' },
  ]
  expect(findSavedSearchLocation(differentPlaces, candidate, 'Office')).toBeUndefined()
  expect(
    findSavedSearchLocation([...differentPlaces, savedLocation], candidate, 'Office')
  ).toBe(savedLocation)
})

test('validates saved-location request and response envelopes', () => {
  expect(savedLocationSchema.parse(savedLocation)).toEqual(savedLocation)
  expect(
    createSavedLocationInputSchema.parse({
      label: 'Office',
      locationKey: 'chicago-il',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: ' America/Chicago ',
      city: 'Chicago',
      region: 'IL',
      country: 'US',
    })
  ).toMatchObject({
    label: 'Office',
    locationKey: 'chicago-il',
    timezone: 'America/Chicago',
  })
  expect(
    updateSavedLocationInputSchema.parse({
      label: 'Home',
      sortOrder: 1,
    })
  ).toEqual({
    label: 'Home',
    sortOrder: 1,
  })
  expect(listSavedLocationsResponseSchema.parse({ data: [savedLocation] })).toEqual({
    data: [savedLocation],
  })
  expect(createSavedLocationResponseSchema.parse({ data: savedLocation })).toMatchObject({
    data: { locationKey: 'chicago-il' },
  })
  expect(
    setPrimarySavedLocationResponseSchema.parse({ data: savedLocation })
  ).toMatchObject({
    data: { isPrimary: true },
  })
  expect(deleteSavedLocationResponseSchema.parse({ data: { deleted: true } })).toEqual({
    data: { deleted: true },
  })
})

test('rejects user-owned and invalid saved-location input fields', () => {
  expect(() =>
    createSavedLocationInputSchema.parse({
      userId: 'client-supplied-user',
      label: 'Office',
      locationKey: 'chicago-il',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    })
  ).toThrow()

  expect(() =>
    createSavedLocationInputSchema.parse({
      label: 'Office',
      locationKey: ' CHICAGO IL ',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    })
  ).toThrow()

  expect(() =>
    createSavedLocationInputSchema.parse({
      label: 'Office',
      locationKey: 'chicago-il',
      latitude: 91,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    })
  ).toThrow()

  expect(() =>
    createSavedLocationInputSchema.parse({
      label: 'Office',
      locationKey: 'chicago-il',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: '   ',
    })
  ).toThrow()

  expect(() =>
    updateSavedLocationInputSchema.parse({
      locationKey: 'new-york-ny',
    })
  ).toThrow()

  expect(() =>
    updateSavedLocationInputSchema.parse({
      isPrimary: true,
    })
  ).toThrow()

  expect(() =>
    updateSavedLocationInputSchema.parse({
      sortOrder: 2_147_483_648,
    })
  ).toThrow()
})

test('registers authenticated saved-location routes in OpenAPI', () => {
  const spec = generateHttpOpenApiDocument()

  const collectionPath = spec.paths?.['/api/v1/locations']
  const memberPath = spec.paths?.['/api/v1/locations/{locationId}']
  const primaryPath = spec.paths?.['/api/v1/locations/{locationId}/primary']

  expect(collectionPath?.get?.security).toEqual([{ bearerAuth: [] }])
  expect(collectionPath?.post?.responses?.['201']).toBeDefined()
  expect(memberPath?.patch?.responses?.['404']).toBeDefined()
  expect(memberPath?.delete?.responses?.['200']).toBeDefined()
  expect(primaryPath?.post?.responses?.['200']).toBeDefined()
  expect(primaryPath?.post?.security).toEqual([{ bearerAuth: [] }])
})
