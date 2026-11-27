// Story 6.16 D3: the guest sample catalog is its own vocabulary. Nothing here is shaped
// like a persisted GarmentItem, RitualResponse, capsule or community post.
import { z } from 'zod'
import { COMFORT_RANGES } from '../comfort-rules'
import { GARMENT_SUBTYPES, garmentSubtypeMatchesCategory } from './garment-subtypes'

/** Mirrors `garmentCategoryEnum` in `@couture/api-client` contracts/http/wardrobe.ts. */
export const SAMPLE_GARMENT_CATEGORIES = [
  'top',
  'bottom',
  'outerwear',
  'dress',
  'shoes',
  'accessory',
] as const
export type SampleGarmentCategory = (typeof SAMPLE_GARMENT_CATEGORIES)[number]

/** Mirrors `garmentMaterialEnum` in `@couture/api-client` contracts/http/wardrobe.ts. */
export const SAMPLE_GARMENT_MATERIALS = [
  'cotton',
  'wool',
  'linen',
  'leather',
  'denim',
  'fleece',
  'synthetic',
  'down',
  'silk',
] as const
export type SampleGarmentMaterial = (typeof SAMPLE_GARMENT_MATERIALS)[number]

export const SAMPLE_COLLECTIONS = ['womenswear', 'menswear'] as const
export type SampleCollection = (typeof SAMPLE_COLLECTIONS)[number]

/** The browse filter: `all` is the default and asks nothing about the visitor. */
export const SAMPLE_COLLECTION_FILTERS = ['all', ...SAMPLE_COLLECTIONS] as const
export type SampleCollectionFilter = (typeof SAMPLE_COLLECTION_FILTERS)[number]

export const SAMPLE_STYLE_OPTIONS = {
  style: ['active', 'chic', 'cozy'],
  palette: ['neutral', 'colorful'],
  texture: ['smooth', 'textured'],
} as const

export const sampleStylePreferencesSchema = z
  .object({
    style: z.enum(SAMPLE_STYLE_OPTIONS.style).optional(),
    palette: z.enum(SAMPLE_STYLE_OPTIONS.palette).optional(),
    texture: z.enum(SAMPLE_STYLE_OPTIONS.texture).optional(),
  })
  .strict()
export type SampleStylePreferences = z.infer<typeof sampleStylePreferencesSchema>

export const SAMPLE_ART_KEYS = [
  'tee',
  'shirt',
  'sweater',
  'blouse',
  'polo',
  'camisole',
  'tank',
  'crop-top',
  'trousers',
  'jeans',
  'shorts',
  'skirt',
  'pleated-skirt',
  'mini-skirt',
  'maxi-skirt',
  'leggings',
  'knit-dress',
  'wrap-dress',
  'sundress',
  'coat',
  'trench',
  'jacket',
  'puffer',
  'shell',
  'blazer',
  'moto-jacket',
  'fleece',
  'boots',
  'moto-boots',
  'knee-boots',
  'sneakers',
  'loafers',
  'sandals',
  'scarf',
  'beanie',
  'tote',
  'sunglasses',
  'tights',
  'socks',
] as const
export type SampleArtKey = (typeof SAMPLE_ART_KEYS)[number]

export const SAMPLE_GARMENT_ID_PATTERN = /^sample:g:[a-z0-9-]{1,48}$/
export const SAMPLE_LOOK_ID_PATTERN = /^sample:l:[a-z0-9-]{1,48}$/

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/)

export const sampleProvenanceSchema = z
  .object({
    authored: z.literal('couture-cast'),
    license: z.literal('project-owned'),
    story: z.literal('6.16'),
  })
  .strict()

export const sampleGarmentSchema = z
  .object({
    id: z.string().regex(SAMPLE_GARMENT_ID_PATTERN),
    category: z.enum(SAMPLE_GARMENT_CATEGORIES),
    subtype: z.enum(GARMENT_SUBTYPES).optional(),
    material: z.enum(SAMPLE_GARMENT_MATERIALS).optional(),
    comfortRanges: z.array(z.enum(COMFORT_RANGES)).min(1),
    windResistant: z.boolean(),
    waterResistant: z.boolean(),
    collections: z.array(z.enum(SAMPLE_COLLECTIONS)).min(1),
    art: z.object({
      key: z.enum(SAMPLE_ART_KEYS),
      primary: hexColor,
      secondary: hexColor,
    }),
    provenance: sampleProvenanceSchema,
  })
  .strict()
  .refine(
    ({ category, subtype }) =>
      subtype === undefined || garmentSubtypeMatchesCategory(category, subtype),
    { path: ['subtype'], message: 'Subtype must match the garment category' }
  )
export type SampleGarment = z.infer<typeof sampleGarmentSchema>

export const sampleLookSchema = z
  .object({
    id: z.string().regex(SAMPLE_LOOK_ID_PATTERN),
    collections: z.array(z.enum(SAMPLE_COLLECTIONS)).min(1),
    core: z.array(z.string().regex(SAMPLE_GARMENT_ID_PATTERN)).min(2),
    layer: z.string().regex(SAMPLE_GARMENT_ID_PATTERN).optional(),
    feedbackCard: z.boolean(),
    preferences: sampleStylePreferencesSchema.optional(),
  })
  .strict()
export type SampleLook = z.infer<typeof sampleLookSchema>

export const sampleCatalogSchema = z
  .object({
    catalogVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
    garments: z.array(sampleGarmentSchema),
    looks: z.array(sampleLookSchema),
  })
  .strict()
export type SampleCatalog = z.infer<typeof sampleCatalogSchema>
