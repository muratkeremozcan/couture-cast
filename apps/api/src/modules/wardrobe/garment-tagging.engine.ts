// Story 4.2 Task 2 step 1 owner: implement pluggable GarmentTaggingEngine interface and confidence scoring in apps/api/src/modules/wardrobe/garment-tagging.engine.ts
import {
  GARMENT_SUBTYPE_ANALYSIS_VERSION,
  garmentTagSuggestionSnapshotSchema,
  type GarmentCategory,
  type GarmentComfortRange,
  type GarmentMaterial,
  type GarmentTagSuggestionSnapshot,
} from '@couture/api-client/contracts/http'
import { garmentSubtypesForCategory, type GarmentSubtype } from '@couture/utils'
export { GARMENT_TAGGING_ANALYSIS_VERSION as ANALYSIS_VERSION } from '@couture/api-client/contracts/http'

export class GarmentTaggingOutputError extends Error {
  readonly code = 'TAGGING_OUTPUT_INVALID'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GarmentTaggingOutputError'
  }
}

/**
 * Stored in `GarmentItem.tagging_failure_code` when the worker runs with
 * `GARMENT_TAGGING_ENGINE=manual`. It marks a deliberate choice, not a fault: the garment has no
 * suggestions because no model ran, and the member chooses the tags. The suggest-tags endpoint
 * answers it with `mode: 'manual'`, so a client learns the mode from the API and never from the
 * worker's environment.
 */
export const TAGGING_MANUAL_MODE_CODE = 'TAGGING_MANUAL_MODE'

/** Thrown by the manual engine so the processor records the manual mode without logging a fault. */
export class GarmentTaggingManualModeError extends Error {
  readonly code = TAGGING_MANUAL_MODE_CODE

  constructor() {
    super('Garment tagging runs in manual mode; the member chooses the tags')
    this.name = 'GarmentTaggingManualModeError'
  }
}

export const CATEGORY_PROMPTS: Record<GarmentCategory, string> = {
  top: 'a photo of a shirt, blouse, sweater, or other upper-body garment',
  bottom: 'a photo of pants, jeans, shorts, or a skirt',
  outerwear: 'a photo of a coat, jacket, blazer, or other outerwear',
  dress: 'a photo of a dress or one-piece garment',
  shoes: 'a photo of shoes, boots, sandals, or other footwear',
  accessory: 'a photo of a wearable accessory such as a bag, scarf, hat, or belt',
}

export const MATERIAL_PROMPTS: Record<GarmentMaterial, string> = {
  cotton: 'a garment made primarily from cotton fabric',
  wool: 'a garment made primarily from wool',
  linen: 'a garment made primarily from linen',
  leather: 'a garment made primarily from leather',
  denim: 'a garment made primarily from denim',
  fleece: 'a garment made primarily from fleece',
  synthetic: 'a garment made primarily from synthetic fabric such as polyester or nylon',
  down: 'an insulated garment filled with down',
  silk: 'a garment made primarily from silk',
}

export const CATEGORY_KEYS = Object.keys(CATEGORY_PROMPTS) as GarmentCategory[]
export const MATERIAL_KEYS = Object.keys(MATERIAL_PROMPTS) as GarmentMaterial[]

const SUBTYPE_NAMES: Record<GarmentSubtype, string> = {
  camisole: 'a camisole with thin spaghetti straps',
  tank: 'a sleeveless tank top with wide shoulder straps',
  'crop-top': 'a cropped shirt or crop top',
  'mini-skirt': 'a short above-the-knee mini skirt',
  'midi-skirt': 'a calf-length midi skirt',
  'maxi-skirt': 'a long ankle-length maxi skirt',
  leggings: 'a pair of tight stretchy leggings',
  blazer: 'a tailored blazer or suit jacket',
  'moto-jacket': 'a leather motorcycle jacket with an asymmetric zipper',
  'moto-boots': 'a pair of buckled motorcycle boots',
  'ankle-boots': 'a pair of ankle boots',
  'knee-boots': 'a pair of knee-high boots',
  tights: 'a pair of pantyhose or opaque tights with enclosed feet',
  socks: 'a pair of socks',
}

const OTHER_GARMENT_NAMES: Record<GarmentCategory, readonly string[]> = {
  top: ['a T-shirt', 'a button-down shirt', 'a blouse', 'a sweater'],
  bottom: ['a pair of jeans', 'a pair of trousers', 'a pair of shorts'],
  outerwear: ['a coat', 'a puffer jacket', 'a rain jacket'],
  dress: ['a dress', 'a gown'],
  shoes: ['a pair of sneakers', 'a pair of heels', 'a pair of sandals'],
  accessory: ['a handbag', 'a scarf', 'a hat', 'a belt'],
}

/** Specific garment names carry both the category and subtype signal. */
export const GARMENT_DETAIL_PROMPTS = CATEGORY_KEYS.flatMap((category) => [
  ...garmentSubtypesForCategory(category).map((subtype) => ({
    category,
    subtype,
    text: `a photo of ${SUBTYPE_NAMES[subtype]}`,
  })),
  ...OTHER_GARMENT_NAMES[category].map((name) => ({
    category,
    subtype: null,
    text: `a photo of ${name}`,
  })),
])

export interface ClassificationScore<T extends string | null> {
  value: T
  confidence: number
  isConfident: boolean
}

export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return []
  for (const val of logits) {
    if (!Number.isFinite(val)) {
      throw new Error('Logit array contains non-finite number')
    }
  }
  const maxLogit = Math.max(...logits)
  const exps = logits.map((val) => Math.exp(val - maxLogit))
  const sumExps = exps.reduce((acc, val) => acc + val, 0)
  if (sumExps === 0 || !Number.isFinite(sumExps)) {
    throw new Error('Invalid softmax denominator')
  }
  return exps.map((val) => val / sumExps)
}

export function classifyGroup<T extends string | null>(
  keys: readonly T[],
  logits: number[],
  minScoreThreshold: number,
  minMarginThreshold: number
): ClassificationScore<T> {
  if (keys.length === 0 || keys.length !== logits.length) {
    throw new Error('Keys and logits length mismatch')
  }
  const probabilities = softmax(logits)

  const pairs = keys.map((key, idx) => ({
    key,
    prob: probabilities[idx] ?? 0,
  }))

  pairs.sort((a, b) => b.prob - a.prob)

  const top1 = pairs[0]!
  const top2 = pairs[1]

  const topScore = top1.prob
  const margin = top2 ? top1.prob - top2.prob : top1.prob

  const isConfident = topScore >= minScoreThreshold && margin >= minMarginThreshold

  return {
    value: top1.key,
    confidence: Number(topScore.toFixed(4)),
    isConfident,
  }
}

export function classifyCategory(logits: number[]): ClassificationScore<GarmentCategory> {
  return classifyGroup<GarmentCategory>(CATEGORY_KEYS, logits, 0.55, 0.15)
}

export function classifyMaterial(logits: number[]): ClassificationScore<GarmentMaterial> {
  return classifyGroup<GarmentMaterial>(MATERIAL_KEYS, logits, 0.45, 0.1)
}

export type GarmentTagLogits = {
  categoryLogits: number[]
  materialLogits: number[]
  detailLogits: number[]
}

function validLogitGroup(logits: number[], count: number) {
  return logits.length === count && logits.every(Number.isFinite)
}

export function classifyTagSuggestions({
  categoryLogits,
  materialLogits,
  detailLogits,
}: GarmentTagLogits): GarmentTagSuggestionSnapshot {
  if (
    !validLogitGroup(categoryLogits, CATEGORY_KEYS.length) ||
    !validLogitGroup(materialLogits, MATERIAL_KEYS.length) ||
    !validLogitGroup(detailLogits, GARMENT_DETAIL_PROMPTS.length)
  ) {
    throw new GarmentTaggingOutputError('Invalid garment prompt logits')
  }

  const detail = GARMENT_DETAIL_PROMPTS.map((prompt, index) => ({
    ...prompt,
    score: detailLogits[index]!,
  }))
  const category = classifyCategory(
    CATEGORY_KEYS.map((key, index) =>
      Math.max(
        categoryLogits[index]!,
        ...detail
          .filter((prompt) => prompt.category === key)
          .map((prompt) => prompt.score)
      )
    )
  )
  const material = classifyMaterial(materialLogits)
  const categoryDetail = detail.filter((prompt) => prompt.category === category.value)
  const subtypes = [...garmentSubtypesForCategory(category.value), null]
  const subtype = classifyGroup(
    subtypes,
    subtypes.map((key) =>
      Math.max(
        ...categoryDetail
          .filter((prompt) => prompt.subtype === key)
          .map((prompt) => prompt.score)
      )
    ),
    0.55,
    0.15
  )

  return garmentTagSuggestionSnapshotSchema.parse({
    analysisVersion: GARMENT_SUBTYPE_ANALYSIS_VERSION,
    category,
    subtype: {
      ...subtype,
      isConfident: category.isConfident && subtype.isConfident,
    },
    material,
    comfortRange: deriveComfort(category, material),
  })
}

export function deriveComfort(
  category: ClassificationScore<GarmentCategory>,
  material: ClassificationScore<GarmentMaterial>
): ClassificationScore<GarmentComfortRange> {
  let value: GarmentComfortRange = 'mild'

  const mat = material.value
  const cat = category.value

  if (mat === 'down' || mat === 'wool' || mat === 'fleece') {
    value = 'cold'
  } else if (cat === 'outerwear') {
    value = 'cool'
  } else if (mat === 'denim' || mat === 'leather') {
    value = 'cool'
  } else if (mat === 'cotton' || mat === 'synthetic') {
    value = 'mild'
  } else if (mat === 'silk') {
    value = 'warm'
  } else if (mat === 'linen') {
    value = 'hot'
  } else {
    value = 'mild'
  }

  const bothConfident = category.isConfident && material.isConfident
  let rawConfidence: number
  let isConfident: boolean

  if (bothConfident) {
    rawConfidence = Math.min(category.confidence, material.confidence)
    isConfident = true
  } else {
    rawConfidence = Math.min(Math.min(category.confidence, material.confidence), 0.49)
    isConfident = false
  }

  return {
    value,
    confidence: Number(rawConfidence.toFixed(4)),
    isConfident,
  }
}

export interface GarmentTaggingEngine {
  inferTags(imageBuffer: Buffer): Promise<GarmentTagSuggestionSnapshot>
}
