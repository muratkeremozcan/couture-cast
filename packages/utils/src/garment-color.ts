// Story CC-7.5 D1: one color classifier for the community photo caption and the garment
// `colorFamily` field, so a garment and a community photo name the same pixel the same way.

/** The eleven color families both surfaces name, in caption order. */
export const GARMENT_COLOR_FAMILIES = [
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
] as const
export type GarmentColorFamily = (typeof GARMENT_COLOR_FAMILIES)[number]

function hueOf(red: number, green: number, blue: number, max: number, chroma: number) {
  if (max === red) return (360 + (60 * (green - blue)) / chroma) % 360
  if (max === green) return 120 + (60 * (blue - red)) / chroma
  return 240 + (60 * (red - green)) / chroma
}

/** Names the color family of one sRGB pixel (channels 0 to 255). */
export function classifyRgbColorFamily(
  red: number,
  green: number,
  blue: number
): GarmentColorFamily {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const chroma = max - min
  if (max < 45) return 'black'
  if (chroma < 24) return min > 220 ? 'white' : 'gray'
  const hue = hueOf(red, green, blue, max, chroma)
  if (hue < 20 || hue >= 345) return min > 110 ? 'pink' : 'red'
  if (hue < 50) return max < 160 ? 'brown' : 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 168) return 'green'
  if (hue < 253) return 'blue'
  if (hue < 313) return 'purple'
  return 'pink'
}

const HEX_COLOR = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

/**
 * Classifies a stored six-digit hex color with an optional leading `#`, in any case (`#1e40af`,
 * `1E40AF`). Anything else, including null, an empty string, surrounding whitespace and the
 * three-digit shorthand, has no family.
 */
export function colorFamilyFromHex(
  hex: string | null | undefined
): GarmentColorFamily | null {
  if (typeof hex !== 'string') return null
  const match = HEX_COLOR.exec(hex)
  if (!match) return null
  const [, red = '', green = '', blue = ''] = match
  return classifyRgbColorFamily(
    Number.parseInt(red, 16),
    Number.parseInt(green, 16),
    Number.parseInt(blue, 16)
  )
}
