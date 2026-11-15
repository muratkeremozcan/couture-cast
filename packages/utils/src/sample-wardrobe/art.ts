// Story 6.16 D3: first-party flat garment illustrations, authored for CoutureCast as
// SVG path data on a 64 by 64 grid. Each platform draws them with its own SVG renderer
// (React DOM on web, react-native-svg on mobile), so no binary asset ships.
import type { SampleArtKey, SampleGarmentCategory } from './types'

export const SAMPLE_ART_VIEWBOX = '0 0 64 64'

export type SampleArtTone = 'primary' | 'secondary'

export type SampleArtPath = {
  d: string
  tone: SampleArtTone
  /** Stroked detail lines (seams, buttons) instead of a filled shape. */
  stroke?: boolean
}

const LONG_SLEEVE_BODY =
  'M21 9 L27 7 L32 12 L37 7 L43 9 L57 44 L50 47 L45 30 L45 56 L19 56 L19 30 L14 47 L7 44 Z'
const SHORT_SLEEVE_BODY =
  'M21 9 L27 7 Q32 12 37 7 L43 9 L55 20 L49 27 L45 24 L45 56 L19 56 L19 24 L15 27 L9 20 Z'
const TROUSER_BODY = 'M18 8 L46 8 L48 57 L36 57 L32 23 L28 57 L16 57 Z'
const LONG_COAT_BODY =
  'M20 6 L27 4 L32 12 L37 4 L44 6 L57 46 L50 49 L46 32 L48 60 L16 60 L18 32 L14 49 L7 46 Z'
const SHORT_JACKET_BODY =
  'M20 8 L27 6 L32 13 L37 6 L44 8 L57 42 L50 45 L46 30 L47 48 L17 48 L18 30 L14 45 L7 42 Z'

export const SAMPLE_ART: Readonly<Record<SampleArtKey, readonly SampleArtPath[]>> = {
  tee: [
    { d: SHORT_SLEEVE_BODY, tone: 'primary' },
    { d: 'M27 7 Q32 12 37 7', tone: 'secondary', stroke: true },
  ],
  shirt: [
    { d: LONG_SLEEVE_BODY, tone: 'primary' },
    { d: 'M27 7 L32 12 L37 7 L35 6 L32 9 L29 6 Z', tone: 'secondary' },
    {
      d: 'M32 12 L32 56 M30 20 L34 20 M30 30 L34 30 M30 40 L34 40',
      tone: 'secondary',
      stroke: true,
    },
  ],
  sweater: [
    {
      d: 'M21 9 Q32 15 43 9 L57 44 L50 47 L45 30 L45 56 L19 56 L19 30 L14 47 L7 44 Z',
      tone: 'primary',
    },
    {
      d: 'M19 51 L45 51 L45 56 L19 56 Z M7 44 L14 47 L13 49 L6 46 Z M57 44 L50 47 L51 49 L58 46 Z',
      tone: 'secondary',
    },
  ],
  blouse: [
    {
      d: 'M21 9 L28 7 L32 16 L36 7 L43 9 L56 22 L49 29 L45 25 L45 56 L19 56 L19 25 L15 29 L8 22 Z',
      tone: 'primary',
    },
    { d: 'M28 7 L32 16 L36 7', tone: 'secondary', stroke: true },
  ],
  polo: [
    { d: SHORT_SLEEVE_BODY, tone: 'primary' },
    {
      d: 'M27 7 L32 12 L37 7 L35 6 L32 9 L29 6 Z M31 12 L33 12 L33 22 L31 22 Z',
      tone: 'secondary',
    },
  ],
  trousers: [
    { d: TROUSER_BODY, tone: 'primary' },
    { d: 'M18 8 L46 8 L46 13 L18 13 Z', tone: 'secondary' },
  ],
  jeans: [
    { d: TROUSER_BODY, tone: 'primary' },
    {
      d: 'M18 13 Q23 19 27 13 M46 13 Q41 19 37 13 M32 13 L32 23',
      tone: 'secondary',
      stroke: true,
    },
  ],
  shorts: [
    { d: 'M17 10 L47 10 L50 40 L35 40 L32 25 L29 40 L14 40 Z', tone: 'primary' },
    { d: 'M17 10 L47 10 L47 15 L17 15 Z', tone: 'secondary' },
  ],
  skirt: [
    { d: 'M22 9 L42 9 L52 55 L12 55 Z', tone: 'primary' },
    { d: 'M22 9 L42 9 L43 14 L21 14 Z', tone: 'secondary' },
  ],
  'pleated-skirt': [
    { d: 'M22 9 L42 9 L50 46 L14 46 Z', tone: 'primary' },
    { d: 'M26 14 L22 46 M32 14 L32 46 M38 14 L42 46', tone: 'secondary', stroke: true },
  ],
  'knit-dress': [
    {
      d: 'M24 6 Q32 11 40 6 L53 32 L47 34 L42 22 L48 59 L16 59 L22 22 L17 34 L11 32 Z',
      tone: 'primary',
    },
    { d: 'M16 54 L48 54 L48 59 L16 59 Z', tone: 'secondary' },
  ],
  'wrap-dress': [
    {
      d: 'M24 6 L32 18 L40 6 L46 12 L43 24 L50 59 L14 59 L21 24 L18 12 Z',
      tone: 'primary',
    },
    { d: 'M24 6 L40 30 M22 26 L42 26', tone: 'secondary', stroke: true },
  ],
  sundress: [
    {
      d: 'M24 6 L26 6 L27 18 L37 18 L38 6 L40 6 L41 21 L51 59 L13 59 L23 21 Z',
      tone: 'primary',
    },
    { d: 'M23 21 L41 21 L41 25 L23 25 Z', tone: 'secondary' },
  ],
  coat: [
    { d: LONG_COAT_BODY, tone: 'primary' },
    {
      d: 'M27 4 L32 12 L37 4 M32 12 L32 60 M28 24 L28 25 M28 34 L28 35 M28 44 L28 45',
      tone: 'secondary',
      stroke: true,
    },
  ],
  trench: [
    { d: LONG_COAT_BODY, tone: 'primary' },
    { d: 'M17 34 L47 34 L47 38 L17 38 Z', tone: 'secondary' },
    { d: 'M27 4 L32 12 L37 4 M32 12 L32 60', tone: 'secondary', stroke: true },
  ],
  jacket: [
    { d: SHORT_JACKET_BODY, tone: 'primary' },
    {
      d: 'M27 6 L32 13 L37 6 M32 13 L32 48 M22 22 L28 22 M36 22 L42 22',
      tone: 'secondary',
      stroke: true,
    },
  ],
  puffer: [
    { d: SHORT_JACKET_BODY, tone: 'primary' },
    {
      d: 'M18 20 L46 20 M18 29 L46 29 M18 38 L46 38 M32 13 L32 48',
      tone: 'secondary',
      stroke: true,
    },
  ],
  shell: [
    { d: SHORT_JACKET_BODY, tone: 'primary' },
    { d: 'M24 9 Q32 -1 40 9 L37 6 Q32 2 27 6 Z', tone: 'primary' },
    { d: 'M32 13 L32 48', tone: 'secondary', stroke: true },
  ],
  blazer: [
    { d: SHORT_JACKET_BODY, tone: 'primary' },
    { d: 'M27 6 L32 13 L37 6 L36 18 L32 26 L28 18 Z', tone: 'secondary' },
  ],
  fleece: [
    { d: SHORT_JACKET_BODY, tone: 'primary' },
    { d: 'M32 6 L32 48 M27 6 L37 6 L37 10 L27 10 Z', tone: 'secondary', stroke: true },
  ],
  boots: [
    { d: 'M18 10 L32 10 L32 40 L52 44 Q57 46 57 52 L57 56 L18 56 Z', tone: 'primary' },
    { d: 'M18 52 L57 52 L57 56 L18 56 Z', tone: 'secondary' },
  ],
  sneakers: [
    { d: 'M7 38 L25 31 L35 38 L54 42 Q58 44 58 50 L58 54 L7 54 Z', tone: 'primary' },
    { d: 'M7 50 L58 50 L58 54 L7 54 Z', tone: 'secondary' },
  ],
  loafers: [
    { d: 'M8 42 Q14 34 26 36 L46 40 Q58 42 58 50 L58 53 L8 53 Z', tone: 'primary' },
    { d: 'M30 38 L44 41', tone: 'secondary', stroke: true },
  ],
  sandals: [
    { d: 'M8 48 Q8 44 14 44 L54 46 Q58 47 58 50 L58 53 L8 53 Z', tone: 'secondary' },
    { d: 'M18 46 L26 34 L34 46 M38 46 L44 36 L50 46', tone: 'primary', stroke: true },
  ],
  scarf: [
    { d: 'M14 10 L50 10 L50 20 L37 22 L41 56 L30 56 L27 22 L14 20 Z', tone: 'primary' },
    { d: 'M30 50 L41 50 M30 53 L41 53', tone: 'secondary', stroke: true },
  ],
  beanie: [
    { d: 'M14 40 Q14 12 32 12 Q50 12 50 40 Z', tone: 'primary' },
    { d: 'M12 38 L52 38 L52 48 L12 48 Z', tone: 'secondary' },
  ],
  tote: [
    { d: 'M14 22 L50 22 L46 56 L18 56 Z', tone: 'primary' },
    { d: 'M22 22 Q22 8 32 8 Q42 8 42 22', tone: 'secondary', stroke: true },
  ],
  sunglasses: [
    {
      d: 'M8 26 L28 26 L26 38 Q18 42 10 38 Z M36 26 L56 26 L54 38 Q46 42 38 38 Z',
      tone: 'primary',
    },
    {
      d: 'M28 28 Q32 25 36 28 M8 26 L4 22 M56 26 L60 22',
      tone: 'secondary',
      stroke: true,
    },
  ],
}

/** Shown when a garment's art key is unknown: one neutral glyph per category (D7 fallback). */
export const SAMPLE_CATEGORY_FALLBACK_ART: Readonly<
  Record<SampleGarmentCategory, SampleArtKey>
> = {
  top: 'tee',
  bottom: 'trousers',
  outerwear: 'jacket',
  dress: 'knit-dress',
  shoes: 'sneakers',
  accessory: 'tote',
}

export const SAMPLE_FALLBACK_COLORS = {
  primary: '#9ca3af',
  secondary: '#6b7280',
} as const

/**
 * Resolves the paths and colors to draw. An unknown key, which can only come from a
 * catalog bug, draws the category glyph in neutral grey so the tile stays usable.
 */
export function resolveSampleArt(
  art: { key: string; primary: string; secondary: string },
  category: SampleGarmentCategory
): {
  paths: readonly SampleArtPath[]
  primary: string
  secondary: string
  fallback: boolean
} {
  const paths = (SAMPLE_ART as Readonly<Record<string, readonly SampleArtPath[]>>)[
    art.key
  ]
  if (paths)
    return { paths, primary: art.primary, secondary: art.secondary, fallback: false }
  return {
    paths: SAMPLE_ART[SAMPLE_CATEGORY_FALLBACK_ART[category]],
    ...SAMPLE_FALLBACK_COLORS,
    fallback: true,
  }
}
