// Story 7.5 test plan 7.5-UNIT-001..003: shared garment color classifier.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
//
// The classifier moved here from apps/api community-photo-caption.ts so the community caption and
// the wardrobe `colorFamily` field share one table. The expectations below were computed from the
// pre-move implementation (baseline ea93273b), so any drift in the thresholds fails here.
import { describe, expect, it } from 'vitest'
import {
  classifyRgbColorFamily,
  colorFamilyFromHex,
  GARMENT_COLOR_FAMILIES,
} from './garment-color'

describe('GARMENT_COLOR_FAMILIES', () => {
  it('[P1] [7.5-UNIT-001] keeps the 11 families in caption order', () => {
    expect(GARMENT_COLOR_FAMILIES).toEqual([
      'black',
      'gray',
      'white',
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'brown',
    ])
  })
})

describe('classifyRgbColorFamily', () => {
  it.each([
    [[0, 0, 0], 'black'],
    [[128, 128, 150], 'gray'],
    [[221, 221, 244], 'white'],
    [[200, 30, 30], 'red'],
    [[200, 120, 20], 'orange'],
    [[200, 200, 20], 'yellow'],
    [[20, 160, 40], 'green'],
    [[30, 60, 200], 'blue'],
    [[120, 40, 200], 'purple'],
    [[230, 40, 160], 'pink'],
    [[140, 80, 20], 'brown'],
  ] as const)(
    '[P1] [7.5-UNIT-001] classifies rgb(%j) as %s',
    ([red, green, blue], family) => {
      expect(classifyRgbColorFamily(red, green, blue)).toBe(family)
    }
  )

  it.each([
    // max 44 is black, max 45 leaves the black band
    [[44, 44, 200], 'blue'],
    [[44, 44, 44], 'black'],
    [[45, 45, 45], 'gray'],
    // low chroma: min above 220 is white, 220 is still gray
    [[220, 220, 243], 'gray'],
    [[221, 221, 244], 'white'],
    // red hues split on min 110 into red and pink
    [[220, 20, 50], 'red'],
    [[230, 140, 150], 'pink'],
    [[255, 120, 111], 'pink'],
    // orange hues split on max 160 into brown and orange
    [[150, 90, 30], 'brown'],
    [[160, 96, 30], 'orange'],
    // cyan sits inside the blue band, hue 340 inside the late pink band
    [[60, 200, 220], 'blue'],
    [[255, 0, 85], 'pink'],
  ] as const)(
    '[P1] [7.5-UNIT-002] keeps the pre-move boundary for rgb(%j) as %s',
    ([red, green, blue], family) => {
      expect(classifyRgbColorFamily(red, green, blue)).toBe(family)
    }
  )
})

describe('colorFamilyFromHex', () => {
  it.each([
    ['#1E3CC8', 'blue'],
    ['#1e3cc8', 'blue'],
    ['1e3cc8', 'blue'],
    ['#000000', 'black'],
    ['#ffffff', 'white'],
  ] as const)('[P1] [7.5-UNIT-003] reads %s as %s', (hex, family) => {
    expect(colorFamilyFromHex(hex)).toBe(family)
  })

  it.each([
    null,
    undefined,
    '',
    '#',
    '#fff',
    '#12345',
    '#1234567',
    '#gg0000',
    'blue',
    ' #1e3cc8 x',
  ])('[P1] [7.5-UNIT-003] returns null for malformed input %j', (hex) => {
    expect(colorFamilyFromHex(hex)).toBeNull()
  })
})
