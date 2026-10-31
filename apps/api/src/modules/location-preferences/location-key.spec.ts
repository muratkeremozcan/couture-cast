// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
import { describe, expect, it } from 'vitest'
import { savedLocationSchema } from '../../contracts/http'
import {
  buildSearchLocationKey,
  isSearchLocationKey,
  LOCATION_KEY_MAX_LENGTH,
  type LocationKeySource,
} from './location-key'

const chicago: LocationKeySource = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.871,
  longitude: -87.631,
}

/** A search place: Chicago unless a case says otherwise. */
const place = (overrides: Partial<LocationKeySource> = {}): LocationKeySource => ({
  ...chicago,
  ...overrides,
})

describe('buildSearchLocationKey', () => {
  it('1.2b-UNIT-KEY-01 joins folded name, region and country with hemisphere coordinates', () => {
    const key = buildSearchLocationKey(chicago)

    // The spec example `41.871n-87.631w` normalizes to `41-871n-87-631w`.
    expect(key).toBe('chicago-illinois-us-41-871n-87-631w')
    expect(savedLocationSchema.shape.locationKey.safeParse(key).success).toBe(true)
  })

  it('1.2b-UNIT-KEY-02 keeps same-name cities in different regions distinct', () => {
    const springfield = place({ city: 'Springfield' })

    // Exact keys: the region has to be in the key, not only the coordinates.
    expect(
      buildSearchLocationKey({
        ...springfield,
        region: 'Illinois',
        latitude: 39.782,
        longitude: -89.65,
      })
    ).toBe('springfield-illinois-us-39-782n-89-650w')
    expect(
      buildSearchLocationKey({
        ...springfield,
        region: 'Missouri',
        latitude: 37.209,
        longitude: -93.292,
      })
    ).toBe('springfield-missouri-us-37-209n-93-292w')
  })

  it('1.2b-UNIT-KEY-03 keeps same name, region and country at different coordinates distinct', () => {
    const base = { city: 'Twinbrook', region: 'Maryland', country: 'US' }

    expect(buildSearchLocationKey({ ...base, latitude: 39, longitude: -77.1 })).not.toBe(
      buildSearchLocationKey({ ...base, latitude: 39.6, longitude: -77.6 })
    )
    // One thousandth of a degree is the stored precision, and it still differs.
    expect(
      buildSearchLocationKey({ ...base, latitude: 39.001, longitude: -77.1 })
    ).not.toBe(buildSearchLocationKey({ ...base, latitude: 39.002, longitude: -77.1 }))
  })

  it.each([
    [
      'Turkish dotted I',
      place({
        city: 'İstanbul',
        region: 'İstanbul',
        country: 'TR',
        latitude: 41.008,
        longitude: 28.978,
      }),
      'istanbul-istanbul-tr-41-008n-28-978e',
    ],
    [
      'Turkish dotless i',
      place({
        city: 'Diyarbakır',
        region: 'Diyarbakır',
        country: 'TR',
        latitude: 37.914,
        longitude: 40.23,
      }),
      'diyarbakir-diyarbakir-tr-37-914n-40-230e',
    ],
    [
      'combining marks',
      place({
        city: 'São Paulo',
        region: 'São Paulo',
        country: 'BR',
        latitude: -23.551,
        longitude: -46.633,
      }),
      'sao-paulo-sao-paulo-br-23-551s-46-633w',
    ],
  ])('1.2b-UNIT-KEY-04 folds %s to ASCII', (_case, source, expected) => {
    expect(buildSearchLocationKey(source)).toBe(expected)
  })

  it.each([
    [
      '1.2b-UNIT-KEY-05 omits a missing region and pads coordinates to three decimals',
      place({
        city: 'Monaco',
        region: null,
        country: 'MC',
        latitude: 43.7,
        longitude: 7,
      }),
      'monaco-mc-43-700n-7-000e',
    ],
    [
      '1.2b-UNIT-KEY-06 still keys a name with no Latin letters by country and coordinates',
      place({
        city: '東京',
        region: '東京都',
        country: 'JP',
        latitude: 35.69,
        longitude: 139.692,
      }),
      'jp-35-690n-139-692e',
    ],
  ])('%s', (_title, source, expected) => {
    expect(buildSearchLocationKey(source)).toBe(expected)
  })

  it('1.2b-UNIT-KEY-07 shortens names, never the country or coordinates, to the 120-character cap', () => {
    const key = buildSearchLocationKey(
      place({
        city: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch'.repeat(2),
        region:
          'Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu',
        country: 'GB',
        latitude: -89.999,
        longitude: -179.999,
      })
    )

    expect(key.length).toBeLessThanOrEqual(LOCATION_KEY_MAX_LENGTH)
    expect(key.endsWith('-gb-89-999s-179-999w')).toBe(true)
    expect(key.startsWith('llanfairpwll')).toBe(true)
    expect(key).toContain('-taumata')
    expect(savedLocationSchema.shape.locationKey.safeParse(key).success).toBe(true)
  })

  it('1.2b-UNIT-KEY-08 fits exactly at the cap when one part is short', () => {
    const key = buildSearchLocationKey(
      place({ city: 'a'.repeat(200), region: 'Ohio', latitude: 10, longitude: 10 })
    )

    expect(key).toHaveLength(LOCATION_KEY_MAX_LENGTH)
    expect(key).toContain('-ohio-us-10-000n-10-000e')
  })

  it('1.2b-UNIT-KEY-09 treats a rounded negative zero as the northern and eastern hemisphere', () => {
    expect(
      buildSearchLocationKey(place({ latitude: 0, longitude: -0 })).endsWith(
        '0-000n-0-000e'
      )
    ).toBe(true)
  })
})

describe('isSearchLocationKey', () => {
  it('1.2b-UNIT-KEY-10 recognizes only keys with the coordinate suffix', () => {
    expect(isSearchLocationKey(buildSearchLocationKey(chicago))).toBe(true)
    expect(isSearchLocationKey('jp-35-690n-139-692e')).toBe(true)
    expect(isSearchLocationKey('chicago-il')).toBe(false)
    expect(isSearchLocationKey('new-york-ny')).toBe(false)
  })
})
