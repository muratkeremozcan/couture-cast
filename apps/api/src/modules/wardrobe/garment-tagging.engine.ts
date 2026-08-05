// Story 4.2 Task 2 step 1 owner: implement pluggable GarmentTaggingEngine interface and confidence scoring in apps/api/src/modules/wardrobe/garment-tagging.engine.ts
import type {
  GarmentCategory,
  GarmentComfortRange,
  GarmentMaterial,
  GarmentTagSuggestionSnapshot,
} from '@couture/api-client/contracts/http'
export { GARMENT_TAGGING_ANALYSIS_VERSION as ANALYSIS_VERSION } from '@couture/api-client/contracts/http'

export class GarmentTaggingOutputError extends Error {
  readonly code = 'TAGGING_OUTPUT_INVALID'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GarmentTaggingOutputError'
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

export interface ClassificationScore<T extends string> {
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

export function classifyGroup<T extends string>(
  keys: readonly T[],
  logits: number[],
  minScoreThreshold: number,
  minMarginThreshold: number
): ClassificationScore<T> {
  if (keys.length !== logits.length) {
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
