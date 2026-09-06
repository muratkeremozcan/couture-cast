// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
/**
 * Story 5.4 Task 2: pins the closed-form colour science Decision 3 requires.
 * Floating-point results are asserted with `toBeCloseTo(value, 2)`, never
 * `toBe` (5.3's dev-record lesson, restated in this story's Decisions).
 */
import { describe, expect, it } from 'vitest'
import {
  chroma,
  classifyDepth,
  classifyUndertone,
  COOL_HUE_MAX,
  hueAngleDegrees,
  hueAngleInterquartileSpread,
  individualTypologyAngle,
  ITA_FAIR_MIN,
  ITA_LIGHT_MIN,
  ITA_MEDIUM_MIN,
  ITA_TAN_MIN,
  type Lab,
  linearRgbToLab,
  NEUTRAL_CHROMA_MAX,
  OLIVE_HUE_MAX,
  OLIVE_HUE_MIN,
  srgbToLab,
  WARM_HUE_MAX,
} from './skin-tone'

/** Builds a Lab point at an exact hue angle (degrees) and chroma radius, for pinning boundaries precisely. */
function labAtHue(degrees: number, radius = 40, L = 50): Lab {
  const radians = (degrees * Math.PI) / 180
  return { L, a: radius * Math.cos(radians), b: radius * Math.sin(radians) }
}

describe('srgbToLab / linearRgbToLab', () => {
  // Published reference CIELAB values for the sRGB primaries under D65
  // (Bruce Lindbloom's widely-cited reference table), used as an
  // independent cross-check that the sRGB -> linear -> XYZ -> Lab pipeline
  // is implemented correctly and not merely self-consistent.
  it('5.4-UTIL-001 round-trips white to L*=100, a*=0, b*=0', () => {
    const lab = srgbToLab('#FFFFFF')
    expect(lab.L).toBeCloseTo(100, 2)
    expect(lab.a).toBeCloseTo(0, 2)
    expect(lab.b).toBeCloseTo(0, 2)
  })

  it('5.4-UTIL-002 round-trips black to L*=0, a*=0, b*=0', () => {
    const lab = srgbToLab('#000000')
    expect(lab.L).toBeCloseTo(0, 2)
    expect(lab.a).toBeCloseTo(0, 2)
    expect(lab.b).toBeCloseTo(0, 2)
  })

  it('5.4-UTIL-003 round-trips pure red to the published reference Lab', () => {
    const lab = srgbToLab('#FF0000')
    expect(lab.L).toBeCloseTo(53.24, 2)
    expect(lab.a).toBeCloseTo(80.09, 2)
    expect(lab.b).toBeCloseTo(67.2, 2)
  })

  it('5.4-UTIL-004 round-trips pure green to the published reference Lab', () => {
    const lab = srgbToLab('#00FF00')
    expect(lab.L).toBeCloseTo(87.73, 2)
    expect(lab.a).toBeCloseTo(-86.18, 2)
    expect(lab.b).toBeCloseTo(83.18, 2)
  })

  it('5.4-UTIL-005 round-trips pure blue to the published reference Lab', () => {
    const lab = srgbToLab('#0000FF')
    expect(lab.L).toBeCloseTo(32.3, 2)
    expect(lab.a).toBeCloseTo(79.19, 2)
    expect(lab.b).toBeCloseTo(-107.86, 2)
  })

  it('5.4-UTIL-006 accepts #RGB shorthand as the same colour as #RRGGBB', () => {
    const shorthand = srgbToLab('#fff')
    const full = srgbToLab('#FFFFFF')
    expect(shorthand.L).toBeCloseTo(full.L, 6)
    expect(shorthand.a).toBeCloseTo(full.a, 6)
    expect(shorthand.b).toBeCloseTo(full.b, 6)
  })

  it('5.4-UTIL-007 accepts hex with no leading #', () => {
    const withHash = srgbToLab('#C9A14A')
    const withoutHash = srgbToLab('C9A14A')
    expect(withoutHash.L).toBeCloseTo(withHash.L, 6)
    expect(withoutHash.a).toBeCloseTo(withHash.a, 6)
    expect(withoutHash.b).toBeCloseTo(withHash.b, 6)
  })

  it('5.4-UTIL-008 rejects eight-digit #RRGGBBAA, inheriting the contrast.ts contract', () => {
    expect(() => srgbToLab('#FFFFFF80')).toThrow(/Expected a 3- or 6-digit hex color/)
  })

  it('5.4-UTIL-009 rejects a non-hex input rather than silently returning a Lab value', () => {
    expect(() => srgbToLab('rgb(255, 255, 255)')).toThrow(
      /Expected a 3- or 6-digit hex color/
    )
  })

  it('5.4-UTIL-010 linearRgbToLab and srgbToLab agree once the channels are linearized', () => {
    // srgbToLab('#C9A14A') is the wardrobe seed's fixed hex; its linear-RGB
    // equivalent, fed straight to linearRgbToLab, must produce the same Lab.
    const viaHex = srgbToLab('#C9A14A')
    const viaLinear = linearRgbToLab([
      0.5840784178911641, 0.3564001441459435, 0.06847816984440017,
    ])
    expect(viaLinear.L).toBeCloseTo(viaHex.L, 1)
    expect(viaLinear.a).toBeCloseTo(viaHex.a, 1)
    expect(viaLinear.b).toBeCloseTo(viaHex.b, 1)
  })
})

describe('individualTypologyAngle', () => {
  it('5.4-UTIL-011 computes the published ITA formula for a known Lab point', () => {
    // L*=50 (the formula's own zero point) with b*=1 gives arctan(0/1) = 0.
    expect(individualTypologyAngle({ L: 50, a: 0, b: 1 })).toBeCloseTo(0, 4)
  })

  it('5.4-UTIL-012 returns null when b* is exactly zero', () => {
    expect(individualTypologyAngle({ L: 50, a: 10, b: 0 })).toBeNull()
  })

  it('5.4-UTIL-013 returns null when b* is negative, rather than a nonsensical angle', () => {
    expect(individualTypologyAngle({ L: 50, a: 10, b: -5 })).toBeNull()
  })

  it('5.4-UTIL-014 returns a real angle for the smallest positive b*', () => {
    const ita = individualTypologyAngle({ L: 60, a: 10, b: 0.0001 })
    expect(ita).not.toBeNull()
    expect(Number.isFinite(ita)).toBe(true)
  })

  it('5.4-UTIL-015 pins ITA for pure red (a known srgbToLab fixture)', () => {
    const lab = srgbToLab('#FF0000')
    expect(individualTypologyAngle(lab)).toBeCloseTo(2.76, 2)
  })
})

describe('classifyDepth: all four ITA band boundaries, both sides', () => {
  it.each([
    // [ita, expected]. Exclusive-lower, inclusive-upper: the boundary value
    // itself belongs to the LOWER band.
    [ITA_FAIR_MIN + 0.0001, 'fair'],
    [ITA_FAIR_MIN, 'light'],
    [ITA_FAIR_MIN - 0.0001, 'light'],
    [ITA_LIGHT_MIN + 0.0001, 'light'],
    [ITA_LIGHT_MIN, 'medium'],
    [ITA_LIGHT_MIN - 0.0001, 'medium'],
    [ITA_MEDIUM_MIN + 0.0001, 'medium'],
    [ITA_MEDIUM_MIN, 'tan'],
    [ITA_MEDIUM_MIN - 0.0001, 'tan'],
    [ITA_TAN_MIN + 0.0001, 'tan'],
    [ITA_TAN_MIN, 'deep'],
    [ITA_TAN_MIN - 0.0001, 'deep'],
  ] as const)('5.4-UTIL-020 classifyDepth(%f) -> %s', (ita, expected) => {
    expect(classifyDepth(ita)).toBe(expected)
  })

  it('5.4-UTIL-021 classifies extreme fair and extreme deep inputs', () => {
    expect(classifyDepth(90)).toBe('fair')
    expect(classifyDepth(-90)).toBe('deep')
  })
})

describe('chroma and hueAngleDegrees', () => {
  it('5.4-UTIL-030 computes chroma as the Euclidean distance from the achromatic axis', () => {
    expect(chroma({ L: 50, a: 3, b: 4 })).toBeCloseTo(5, 6)
    expect(chroma({ L: 50, a: 0, b: 0 })).toBeCloseTo(0, 6)
  })

  it('5.4-UTIL-031 wraps hue angle to [0, 360)', () => {
    expect(hueAngleDegrees({ L: 50, a: 1, b: 0 })).toBeCloseTo(0, 4)
    expect(hueAngleDegrees({ L: 50, a: 0, b: 1 })).toBeCloseTo(90, 4)
    expect(hueAngleDegrees({ L: 50, a: -1, b: 0 })).toBeCloseTo(180, 4)
    expect(hueAngleDegrees({ L: 50, a: 0, b: -1 })).toBeCloseTo(270, 4)
  })

  it('5.4-UTIL-032 returns a real angle for a negative a* with positive b*, where a ratio would blow up', () => {
    // b*/a* = 20 / -0.5 = -40: a ratio implementation would report a huge,
    // sign-inverted value. atan2 handles it without incident.
    const lab: Lab = { L: 50, a: -0.5, b: 20 }
    const hue = hueAngleDegrees(lab)
    expect(Number.isFinite(hue)).toBe(true)
    expect(hue).toBeCloseTo(91.43, 2)
  })
})

describe('classifyUndertone: every band, including the boundaries', () => {
  it('5.4-UTIL-040 classifies neutral below the chroma floor, regardless of hue', () => {
    expect(classifyUndertone({ L: 50, a: 2, b: 2 })).toBe('neutral')
    expect(classifyUndertone({ L: 50, a: 0, b: 0 })).toBe('neutral')
  })

  it('5.4-UTIL-041 classifies the chroma boundary itself by hue, and only strictly-below it as neutral', () => {
    // The neutral test is `chroma < NEUTRAL_CHROMA_MAX`, so the boundary
    // value itself already has enough colour to classify by hue; only
    // strictly below the floor is "too little colour to call".
    const atFloor = labAtHue(50, NEUTRAL_CHROMA_MAX)
    expect(chroma(atFloor)).toBeCloseTo(NEUTRAL_CHROMA_MAX, 6)
    expect(classifyUndertone(atFloor)).toBe('warm')

    const justBelow = labAtHue(50, NEUTRAL_CHROMA_MAX - 0.01)
    expect(classifyUndertone(justBelow)).toBe('neutral')
  })

  it('5.4-UTIL-042 classifies cool below COOL_HUE_MAX', () => {
    expect(classifyUndertone(labAtHue(0))).toBe('cool')
    expect(classifyUndertone(labAtHue(COOL_HUE_MAX - 0.01))).toBe('cool')
  })

  it('5.4-UTIL-043 classifies warm at the cool/warm boundary and through the warm band', () => {
    // The boundary value itself belongs to warm, mirroring classifyDepth's
    // exclusive-lower convention.
    expect(classifyUndertone(labAtHue(COOL_HUE_MAX))).toBe('warm')
    expect(classifyUndertone(labAtHue((COOL_HUE_MAX + WARM_HUE_MAX) / 2))).toBe('warm')
    expect(classifyUndertone(labAtHue(WARM_HUE_MAX - 0.01))).toBe('warm')
  })

  it('5.4-UTIL-044 classifies olive at the warm/olive boundary, through the band, up to its own max', () => {
    expect(classifyUndertone(labAtHue(WARM_HUE_MAX))).toBe('olive')
    expect(classifyUndertone(labAtHue(OLIVE_HUE_MIN))).toBe('olive')
    expect(classifyUndertone(labAtHue((OLIVE_HUE_MIN + OLIVE_HUE_MAX) / 2))).toBe('olive')
    expect(classifyUndertone(labAtHue(OLIVE_HUE_MAX - 0.01))).toBe('olive')
  })

  it('5.4-UTIL-045 falls back to cool past OLIVE_HUE_MAX, keeping the function total', () => {
    // True green/cyan/blue/violet hues are unreachable for real skin or
    // garment colour once the upstream chroma gates run, but the function
    // must still answer something for every real (L, a, b) triple.
    expect(classifyUndertone(labAtHue(OLIVE_HUE_MAX))).toBe('cool')
    expect(classifyUndertone(labAtHue(200))).toBe('cool')
    expect(classifyUndertone(labAtHue(350))).toBe('cool')
  })

  it('5.4-UTIL-046 classifies olive for a negative a*, which a b*/a* ratio would misclassify as extreme', () => {
    // ratio = b*/a* = 20 / -5 = -4, which a naive ratio-threshold
    // implementation reads as strongly "cool" (a large-magnitude negative
    // number), inverting the true answer. The hue angle (~104 deg) correctly
    // lands this in the olive band Decision 3 calls out by name.
    const lab: Lab = { L: 50, a: -5, b: 20 }
    expect(hueAngleDegrees(lab)).toBeCloseTo(104.04, 2)
    expect(classifyUndertone(lab)).toBe('olive')
  })

  it('5.4-UTIL-047 classifies a near-zero a* (pure yellow-ish) as olive, not a ratio blow-up', () => {
    const lab: Lab = { L: 50, a: 0.01, b: 20 }
    expect(classifyUndertone(lab)).toBe('olive')
  })
})

describe('hueAngleInterquartileSpread', () => {
  /**
   * The property that makes the circular measure a strict improvement: for any
   * sample that does not straddle the 0/360 wrap, deviations from the mean
   * direction are a pure translation of the inputs, and the interquartile range
   * is translation-invariant.
   */
  it('5.4-UTIL-050 matches a plain interquartile range on a sample that does not wrap', () => {
    const angles = [40, 44, 48, 52, 56, 60]
    // Plain IQR over the same order statistics: sorted[1] and sorted[4].
    expect(hueAngleInterquartileSpread(angles)).toBeCloseTo(56 - 44, 6)
  })

  it('5.4-UTIL-051 reports a tight spread for hues clustered across the 0/360 wrap', () => {
    // Magentas and fuchsias sit just below 360 in CIELAB while reds, corals
    // and pinks sit just above 0. These six agree to within 20 degrees; read
    // linearly they look 350 apart, which is what refused a wardrobe whose
    // colours in fact agreed.
    const angles = [350, 354, 358, 2, 6, 10]
    expect(hueAngleInterquartileSpread(angles)).toBeCloseTo(12, 6)
  })

  it('5.4-UTIL-052 still reports a wide spread for hues that genuinely disagree', () => {
    // The wrap fix must not make disagreement disappear: opposite points on
    // the circle are the maximum possible separation and must stay wide.
    const angles = [0, 2, 178, 180, 182, 358]
    expect(hueAngleInterquartileSpread(angles)).toBeGreaterThan(90)
  })

  it('5.4-UTIL-053 returns 0 below four samples, which is too few to quartile', () => {
    expect(hueAngleInterquartileSpread([])).toBe(0)
    expect(hueAngleInterquartileSpread([10, 200, 300])).toBe(0)
  })

  it('5.4-UTIL-054 is invariant under rotating every angle by the same amount', () => {
    const angles = [12, 30, 47, 61, 88, 104]
    const rotated = angles.map((angle) => (angle + 300) % 360)
    expect(hueAngleInterquartileSpread(rotated)).toBeCloseTo(
      hueAngleInterquartileSpread(angles),
      6
    )
  })
})
