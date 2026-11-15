// Story 6.16 D3: bundled first-party sample catalog. Every garment and its art was
// authored for CoutureCast in this repository; nothing is copied or licensed in.
// Bump `catalogVersion` on any change so stored guest state from an older catalog is
// discarded (D7).
import type { ComfortRange } from '../comfort-rules'
import type {
  SampleArtKey,
  SampleCatalog,
  SampleCollection,
  SampleGarment,
  SampleGarmentCategory,
  SampleGarmentMaterial,
  SampleLook,
} from './types'

export const SAMPLE_CATALOG_VERSION = '2026-11-15.1'

const PROVENANCE = {
  authored: 'couture-cast',
  license: 'project-owned',
  story: '6.16',
} as const

const BOTH: readonly SampleCollection[] = ['womenswear', 'menswear']
const WOMENSWEAR: readonly SampleCollection[] = ['womenswear']
const MENSWEAR: readonly SampleCollection[] = ['menswear']

type GarmentOptions = {
  material?: SampleGarmentMaterial
  wind?: boolean
  water?: boolean
  collections?: readonly SampleCollection[]
}

function garment(
  slug: string,
  category: SampleGarmentCategory,
  comfortRanges: readonly ComfortRange[],
  art: readonly [SampleArtKey, string, string],
  options: GarmentOptions = {}
): SampleGarment {
  const [key, primary, secondary] = art
  return {
    id: `sample:g:${slug}`,
    category,
    ...(options.material ? { material: options.material } : {}),
    comfortRanges: [...comfortRanges],
    windResistant: options.wind ?? false,
    waterResistant: options.water ?? false,
    collections: [...(options.collections ?? BOTH)],
    art: { key, primary, secondary },
    provenance: PROVENANCE,
  }
}

function look(
  slug: string,
  collections: readonly SampleCollection[],
  core: readonly string[],
  feedbackCard: boolean
): SampleLook {
  return {
    id: `sample:l:${slug}`,
    collections: [...collections],
    core: core.map((garmentSlug) => `sample:g:${garmentSlug}`),
    feedbackCard,
  }
}

// Outerwear order matters: the policy picks the first garment that fits, so the
// unprotected layers come first and a wind or rain requirement visibly changes the pick.
const OUTERWEAR: SampleGarment[] = [
  garment('fleece-zip', 'outerwear', ['cold', 'cool'], ['fleece', '#5b6b5a', '#3e4a3d'], {
    material: 'fleece',
  }),
  garment(
    'denim-jacket',
    'outerwear',
    ['cool', 'mild'],
    ['jacket', '#4a6a8f', '#2f4763'],
    {
      material: 'denim',
    }
  ),
  garment(
    'cropped-blazer',
    'outerwear',
    ['cool', 'mild'],
    ['blazer', '#2d2a32', '#8c7a5b'],
    {
      material: 'wool',
      collections: WOMENSWEAR,
    }
  ),
  garment('wool-overcoat', 'outerwear', ['cold'], ['coat', '#2f3b52', '#c9b48a'], {
    material: 'wool',
    wind: true,
  }),
  garment('puffer-jacket', 'outerwear', ['cold'], ['puffer', '#1f2937', '#4b5563'], {
    material: 'down',
    wind: true,
    water: true,
  }),
  garment(
    'trench-coat',
    'outerwear',
    ['cool', 'mild'],
    ['trench', '#b8996b', '#6b5537'],
    {
      material: 'cotton',
      wind: true,
      water: true,
    }
  ),
  garment(
    'rain-shell',
    'outerwear',
    ['mild', 'warm', 'hot'],
    ['shell', '#2f6f6a', '#e6c84f'],
    {
      material: 'synthetic',
      wind: true,
      water: true,
    }
  ),
]

const TOPS: SampleGarment[] = [
  garment(
    'oxford-shirt',
    'top',
    ['cool', 'mild', 'warm'],
    ['shirt', '#dfe7f2', '#7d8fa8'],
    {
      material: 'cotton',
    }
  ),
  garment('merino-sweater', 'top', ['cold', 'cool'], ['sweater', '#7a3b3b', '#5a2a2a'], {
    material: 'wool',
  }),
  garment('cotton-tee', 'top', ['warm', 'hot'], ['tee', '#f4f1ea', '#c8c2b4'], {
    material: 'cotton',
  }),
  garment('cable-knit', 'top', ['cold'], ['sweater', '#e8dcc4', '#bfae8a'], {
    material: 'wool',
    collections: WOMENSWEAR,
  }),
  garment('silk-blouse', 'top', ['mild', 'warm'], ['blouse', '#e9c9c1', '#b98f86'], {
    material: 'silk',
    collections: WOMENSWEAR,
  }),
  garment('polo-shirt', 'top', ['warm', 'hot'], ['polo', '#2e5e4e', '#f4f1ea'], {
    material: 'cotton',
    collections: MENSWEAR,
  }),
  garment('flannel-shirt', 'top', ['cold', 'cool'], ['shirt', '#8a3a2e', '#2b2b2b'], {
    material: 'cotton',
    collections: MENSWEAR,
  }),
  garment('linen-shirt', 'top', ['warm', 'hot'], ['shirt', '#efe6d2', '#b9a97f'], {
    material: 'linen',
    collections: MENSWEAR,
  }),
]

const BOTTOMS: SampleGarment[] = [
  garment(
    'dark-jeans',
    'bottom',
    ['cold', 'cool', 'mild'],
    ['jeans', '#26344d', '#b88a4a'],
    {
      material: 'denim',
    }
  ),
  garment(
    'wool-trousers',
    'bottom',
    ['cold', 'cool'],
    ['trousers', '#3d3d42', '#26262a'],
    {
      material: 'wool',
    }
  ),
  garment('chinos', 'bottom', ['mild', 'warm'], ['trousers', '#c4a77a', '#8f7652'], {
    material: 'cotton',
    collections: MENSWEAR,
  }),
  garment(
    'linen-trousers',
    'bottom',
    ['warm', 'hot'],
    ['trousers', '#e4dccb', '#b5aa92'],
    {
      material: 'linen',
    }
  ),
  garment('midi-skirt', 'bottom', ['mild', 'warm'], ['skirt', '#6d5a8a', '#4b3d61'], {
    material: 'synthetic',
    collections: WOMENSWEAR,
  }),
  garment(
    'pleated-skirt',
    'bottom',
    ['cool', 'mild'],
    ['pleated-skirt', '#4a4a5c', '#2e2e3a'],
    {
      material: 'wool',
      collections: WOMENSWEAR,
    }
  ),
  garment('tailored-shorts', 'bottom', ['hot'], ['shorts', '#9aa58a', '#6c7560'], {
    material: 'cotton',
    collections: MENSWEAR,
  }),
]

const DRESSES: SampleGarment[] = [
  garment('knit-dress', 'dress', ['cold', 'cool'], ['knit-dress', '#5c4033', '#3e2b22'], {
    material: 'wool',
    collections: WOMENSWEAR,
  }),
  garment('wrap-dress', 'dress', ['mild', 'warm'], ['wrap-dress', '#2f5d7c', '#1d3d52'], {
    material: 'synthetic',
    collections: WOMENSWEAR,
  }),
  garment('sundress', 'dress', ['warm', 'hot'], ['sundress', '#e7b75f', '#b8873a'], {
    material: 'cotton',
    collections: WOMENSWEAR,
  }),
]

const SHOES: SampleGarment[] = [
  garment('leather-boots', 'shoes', ['cold', 'cool'], ['boots', '#4a3428', '#2e2019'], {
    material: 'leather',
    water: true,
  }),
  garment(
    'ankle-boots',
    'shoes',
    ['cold', 'cool', 'mild'],
    ['boots', '#1f1f22', '#55555c'],
    {
      material: 'leather',
      collections: WOMENSWEAR,
    }
  ),
  garment(
    'white-sneakers',
    'shoes',
    ['cool', 'mild', 'warm'],
    ['sneakers', '#f5f5f2', '#9aa3ad'],
    {
      material: 'synthetic',
    }
  ),
  garment(
    'loafers',
    'shoes',
    ['cool', 'mild', 'warm'],
    ['loafers', '#5a3a22', '#2e1d10'],
    {
      material: 'leather',
    }
  ),
  garment('sandals', 'shoes', ['warm', 'hot'], ['sandals', '#a8784f', '#6f4c30'], {
    material: 'leather',
  }),
]

const ACCESSORIES: SampleGarment[] = [
  garment('wool-scarf', 'accessory', ['cold', 'cool'], ['scarf', '#9c3d3d', '#e8dcc4'], {
    material: 'wool',
  }),
  garment('beanie', 'accessory', ['cold'], ['beanie', '#3b4a5c', '#d9d4c7'], {
    material: 'wool',
  }),
  garment(
    'canvas-tote',
    'accessory',
    ['cold', 'cool', 'mild', 'warm', 'hot'],
    ['tote', '#d8cdb5', '#7a6a4f'],
    {
      material: 'cotton',
    }
  ),
  garment(
    'sunglasses',
    'accessory',
    ['warm', 'hot'],
    ['sunglasses', '#2b2b2b', '#8a6a3a']
  ),
]

// Looks carry no outerwear: the policy adds a layer when the context calls for one (D5).
// Nine are feedback cards; the other three widen coverage for the browse filters.
const LOOKS: SampleLook[] = [
  look('winter-knit', WOMENSWEAR, ['knit-dress', 'ankle-boots', 'wool-scarf'], true),
  look('city-wool', BOTH, ['merino-sweater', 'wool-trousers', 'leather-boots'], true),
  look(
    'weekend-flannel',
    MENSWEAR,
    ['flannel-shirt', 'dark-jeans', 'leather-boots', 'beanie'],
    true
  ),
  look('soft-pleats', WOMENSWEAR, ['cable-knit', 'pleated-skirt', 'ankle-boots'], true),
  look('office-oxford', BOTH, ['oxford-shirt', 'dark-jeans', 'loafers'], true),
  look('silk-midi', WOMENSWEAR, ['silk-blouse', 'midi-skirt', 'white-sneakers'], true),
  look('easy-chinos', MENSWEAR, ['oxford-shirt', 'chinos', 'white-sneakers'], true),
  look(
    'summer-linen',
    BOTH,
    ['cotton-tee', 'linen-trousers', 'sandals', 'sunglasses'],
    true
  ),
  look('sun-dress', WOMENSWEAR, ['sundress', 'sandals', 'canvas-tote'], true),
  look('wrap-day', WOMENSWEAR, ['wrap-dress', 'loafers', 'canvas-tote'], false),
  look(
    'court-polo',
    MENSWEAR,
    ['polo-shirt', 'tailored-shorts', 'white-sneakers'],
    false
  ),
  look(
    'breezy-linen',
    MENSWEAR,
    ['linen-shirt', 'linen-trousers', 'loafers', 'canvas-tote'],
    false
  ),
]

export const SAMPLE_CATALOG: SampleCatalog = {
  catalogVersion: SAMPLE_CATALOG_VERSION,
  garments: [...OUTERWEAR, ...TOPS, ...BOTTOMS, ...DRESSES, ...SHOES, ...ACCESSORIES],
  looks: LOOKS,
}
