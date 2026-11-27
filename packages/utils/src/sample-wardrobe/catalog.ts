// Story 6.16 D3: bundled first-party sample catalog. Every garment and its art was
// authored for CoutureCast in this repository; nothing is copied or licensed in.
// Bump `catalogVersion` on any change so stored guest state from an older catalog is
// discarded (D7).
import type { ComfortRange } from '../comfort-rules'
import type { GarmentSubtype } from './garment-subtypes'
import type {
  SampleArtKey,
  SampleCatalog,
  SampleCollection,
  SampleGarment,
  SampleGarmentCategory,
  SampleGarmentMaterial,
  SampleLook,
  SampleStylePreferences,
} from './types'

export const SAMPLE_CATALOG_VERSION = '2026-11-27.2'

const PROVENANCE = {
  authored: 'couture-cast',
  license: 'project-owned',
  story: '6.16',
} as const

const BOTH: readonly SampleCollection[] = ['womenswear', 'menswear']
const WOMENSWEAR: readonly SampleCollection[] = ['womenswear']
const MENSWEAR: readonly SampleCollection[] = ['menswear']

type GarmentOptions = {
  subtype?: GarmentSubtype
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
    ...(options.subtype ? { subtype: options.subtype } : {}),
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
  feedbackCard: boolean,
  preferences?: SampleStylePreferences,
  layer?: string
): SampleLook {
  return {
    id: `sample:l:${slug}`,
    collections: [...collections],
    core: core.map((garmentSlug) => `sample:g:${garmentSlug}`),
    ...(layer ? { layer: `sample:g:${layer}` } : {}),
    feedbackCard,
    ...(preferences ? { preferences } : {}),
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
      subtype: 'blazer',
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
  garment(
    'moto-jacket',
    'outerwear',
    ['cool', 'mild'],
    ['moto-jacket', '#323238', '#a3a1a6'],
    {
      subtype: 'moto-jacket',
      material: 'leather',
      wind: true,
      water: true,
    }
  ),
  garment(
    'lined-blazer',
    'outerwear',
    ['cool', 'mild'],
    ['blazer', '#4c5365', '#ababba'],
    {
      subtype: 'blazer',
      material: 'wool',
      wind: true,
      collections: WOMENSWEAR,
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
  garment('ribbed-knit', 'top', ['cool', 'mild'], ['sweater', '#ede1d6', '#baa394'], {
    material: 'cotton',
    collections: WOMENSWEAR,
  }),
  garment('camisole', 'top', ['warm', 'hot'], ['camisole', '#b37c87', '#66414a'], {
    subtype: 'camisole',
    material: 'silk',
    collections: WOMENSWEAR,
  }),
  garment('tank', 'top', ['warm', 'hot'], ['tank', '#86aaa0', '#325a50'], {
    subtype: 'tank',
    material: 'cotton',
  }),
  garment('crop-top', 'top', ['mild', 'warm'], ['crop-top', '#a9a1cc', '#564875'], {
    subtype: 'crop-top',
    material: 'cotton',
    collections: WOMENSWEAR,
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
    subtype: 'midi-skirt',
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
  garment('maxi-skirt', 'bottom', ['warm', 'hot'], ['maxi-skirt', '#566b81', '#8097af'], {
    subtype: 'maxi-skirt',
    material: 'linen',
    collections: WOMENSWEAR,
  }),
  garment(
    'leggings',
    'bottom',
    ['cold', 'cool', 'mild'],
    ['leggings', '#34343e', '#777588'],
    {
      subtype: 'leggings',
      material: 'synthetic',
      collections: WOMENSWEAR,
    }
  ),
  garment('tailored-shorts', 'bottom', ['hot'], ['shorts', '#9aa58a', '#6c7560'], {
    material: 'cotton',
    collections: MENSWEAR,
  }),
  garment(
    'mini-skirt',
    'bottom',
    ['cool', 'mild'],
    ['mini-skirt', '#684555', '#412a36'],
    {
      material: 'wool',
      collections: WOMENSWEAR,
      subtype: 'mini-skirt',
    }
  ),
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
      subtype: 'ankle-boots',
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
  garment('moto-boots', 'shoes', ['cold', 'cool'], ['moto-boots', '#38333b', '#77717c'], {
    subtype: 'moto-boots',
    material: 'leather',
    water: true,
  }),
  garment('knee-boots', 'shoes', ['cold', 'cool'], ['knee-boots', '#744b3f', '#412820'], {
    subtype: 'knee-boots',
    material: 'leather',
    collections: WOMENSWEAR,
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
  garment(
    'opaque-tights',
    'accessory',
    ['cool', 'mild'],
    ['tights', '#27242b', '#48434c'],
    {
      material: 'synthetic',
      collections: WOMENSWEAR,
      subtype: 'tights',
    }
  ),
  garment(
    'ribbed-socks',
    'accessory',
    ['cool', 'mild'],
    ['socks', '#aa8a79', '#dfc9b9'],
    {
      material: 'cotton',
      collections: WOMENSWEAR,
      subtype: 'socks',
    }
  ),
]

// Looks carry no outerwear: the policy adds a layer when the context calls for one (D5).
// Nine are feedback cards. The other looks widen coverage for the browse filters.
const LOOKS: SampleLook[] = [
  look('winter-knit', WOMENSWEAR, ['knit-dress', 'ankle-boots', 'wool-scarf'], true, {
    style: 'cozy',
    fit: 'fitted',
    palette: 'colorful',
    texture: 'textured',
  }),
  look('city-wool', BOTH, ['merino-sweater', 'wool-trousers', 'leather-boots'], true, {
    style: 'classic',
    fit: 'fitted',
    palette: 'colorful',
    texture: 'textured',
  }),
  look(
    'weekend-flannel',
    MENSWEAR,
    ['flannel-shirt', 'dark-jeans', 'leather-boots', 'beanie'],
    true,
    { style: 'active', fit: 'relaxed', palette: 'colorful', texture: 'textured' }
  ),
  look('soft-pleats', WOMENSWEAR, ['cable-knit', 'pleated-skirt', 'ankle-boots'], true, {
    style: 'cozy',
    fit: 'relaxed',
    palette: 'neutral',
    texture: 'textured',
  }),
  look('office-oxford', BOTH, ['oxford-shirt', 'dark-jeans', 'loafers'], true, {
    style: 'classic',
    fit: 'fitted',
    palette: 'neutral',
    texture: 'smooth',
  }),
  look('silk-midi', WOMENSWEAR, ['silk-blouse', 'midi-skirt', 'white-sneakers'], true, {
    style: 'chic',
    fit: 'relaxed',
    palette: 'colorful',
    texture: 'smooth',
  }),
  look('easy-chinos', MENSWEAR, ['oxford-shirt', 'chinos', 'white-sneakers'], true, {
    style: 'active',
    fit: 'fitted',
    palette: 'neutral',
    texture: 'smooth',
  }),
  look(
    'summer-linen',
    BOTH,
    ['cotton-tee', 'linen-trousers', 'sandals', 'sunglasses'],
    true,
    { style: 'active', fit: 'relaxed', palette: 'neutral', texture: 'textured' }
  ),
  look('sun-dress', WOMENSWEAR, ['sundress', 'sandals', 'canvas-tote'], true, {
    style: 'active',
    fit: 'relaxed',
    palette: 'colorful',
    texture: 'smooth',
  }),
  look('wrap-day', WOMENSWEAR, ['wrap-dress', 'loafers', 'canvas-tote'], false, {
    style: 'chic',
    fit: 'fitted',
    palette: 'colorful',
    texture: 'smooth',
  }),
  look(
    'court-polo',
    MENSWEAR,
    ['polo-shirt', 'tailored-shorts', 'white-sneakers'],
    false,
    { style: 'active', fit: 'fitted', palette: 'colorful', texture: 'smooth' }
  ),
  look(
    'breezy-linen',
    MENSWEAR,
    ['linen-shirt', 'linen-trousers', 'loafers', 'canvas-tote'],
    false,
    { style: 'classic', fit: 'relaxed', palette: 'neutral', texture: 'textured' }
  ),
  look(
    'mini-and-tights',
    WOMENSWEAR,
    ['ribbed-knit', 'mini-skirt', 'ankle-boots', 'opaque-tights'],
    false,
    { style: 'cozy', fit: 'fitted', palette: 'colorful', texture: 'textured' }
  ),
  look(
    'weekend-layers',
    WOMENSWEAR,
    ['ribbed-knit', 'leggings', 'moto-boots', 'ribbed-socks'],
    false,
    { style: 'cozy', fit: 'fitted', palette: 'neutral', texture: 'textured' },
    'moto-jacket'
  ),
  look(
    'skirt-and-boots',
    WOMENSWEAR,
    ['merino-sweater', 'mini-skirt', 'knee-boots', 'opaque-tights'],
    false,
    { style: 'chic', fit: 'fitted', palette: 'colorful', texture: 'textured' },
    'lined-blazer'
  ),
  look('summer-skirt', WOMENSWEAR, ['camisole', 'maxi-skirt', 'sandals'], false, {
    style: 'chic',
    fit: 'relaxed',
    palette: 'colorful',
    texture: 'smooth',
  }),
  look('sunny-weekend', BOTH, ['tank', 'linen-trousers', 'sandals'], false, {
    style: 'active',
    fit: 'relaxed',
    palette: 'neutral',
    texture: 'smooth',
  }),
  look(
    'midi-and-sneakers',
    WOMENSWEAR,
    ['crop-top', 'midi-skirt', 'white-sneakers'],
    false,
    {
      style: 'active',
      fit: 'fitted',
      palette: 'colorful',
      texture: 'smooth',
    }
  ),
]

export const SAMPLE_CATALOG: SampleCatalog = {
  catalogVersion: SAMPLE_CATALOG_VERSION,
  garments: [...OUTERWEAR, ...TOPS, ...BOTTOMS, ...DRESSES, ...SHOES, ...ACCESSORIES],
  looks: LOOKS,
}
