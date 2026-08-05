import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CATEGORY_KEYS,
  CATEGORY_PROMPTS,
  MATERIAL_KEYS,
  MATERIAL_PROMPTS,
  classifyCategory,
  classifyMaterial,
  deriveComfort,
  softmax,
} from './garment-tagging.engine'
import type { GarmentCategory, GarmentMaterial } from '@couture/api-client/contracts/http'
import { FixtureGarmentTaggingEngine } from './fixture-garment-tagging.engine'

describe('GarmentTaggingEngine Core Logic', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defines prompts for all canonical categories and materials', () => {
    expect(CATEGORY_KEYS).toHaveLength(6)
    expect(MATERIAL_KEYS).toHaveLength(9)

    for (const key of CATEGORY_KEYS) {
      expect(CATEGORY_PROMPTS[key]).toBeDefined()
      expect(typeof CATEGORY_PROMPTS[key]).toBe('string')
    }

    for (const key of MATERIAL_KEYS) {
      expect(MATERIAL_PROMPTS[key]).toBeDefined()
      expect(typeof MATERIAL_PROMPTS[key]).toBe('string')
    }
  })

  it('normalizes logits using softmax correctly', () => {
    const logits = [2.0, 1.0, 0.1]
    const probs = softmax(logits)

    expect(probs).toHaveLength(3)
    const sum = probs.reduce((acc, v) => acc + v, 0)
    expect(sum).toBeCloseTo(1.0, 4)
    expect(probs[0]).toBeGreaterThan(probs[1]!)
    expect(probs[1]).toBeGreaterThan(probs[2]!)
  })

  it('rejects non-finite logits in softmax', () => {
    expect(() => softmax([1.0, NaN, 2.0])).toThrow('non-finite number')
    expect(() => softmax([1.0, Infinity, 2.0])).toThrow('non-finite number')
    expect(() => softmax([1.0, -Infinity, 2.0])).toThrow('non-finite number')
  })

  it('evaluates category confidence thresholds accurately', () => {
    // High top score and high margin => confident
    const highLogits = [5.0, 1.0, 1.0, 1.0, 1.0, 1.0]
    const catConfident = classifyCategory(highLogits)
    expect(catConfident.value).toBe('top')
    expect(catConfident.confidence).toBeGreaterThanOrEqual(0.55)
    expect(catConfident.isConfident).toBe(true)

    // Close margin top score => low confidence
    const closeLogits = [2.0, 1.95, 1.9, 1.0, 1.0, 1.0]
    const catLowConf = classifyCategory(closeLogits)
    expect(catLowConf.isConfident).toBe(false)
  })

  it('evaluates material confidence thresholds accurately', () => {
    const highLogits = [4.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
    const matConfident = classifyMaterial(highLogits)
    expect(matConfident.value).toBe('cotton')
    expect(matConfident.confidence).toBeGreaterThanOrEqual(0.45)
    expect(matConfident.isConfident).toBe(true)

    const closeLogits = [2.0, 1.95, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
    const matLowConf = classifyMaterial(closeLogits)
    expect(matLowConf.isConfident).toBe(false)
  })

  it('evaluates comfort derivation rules in strict order', () => {
    const cat = (val: GarmentCategory, conf = 0.8, isConf = true) => ({
      value: val,
      confidence: conf,
      isConfident: isConf,
    })
    const mat = (val: GarmentMaterial, conf = 0.8, isConf = true) => ({
      value: val,
      confidence: conf,
      isConfident: isConf,
    })

    // Rule 1: down, wool, or fleece => cold
    expect(deriveComfort(cat('top'), mat('wool')).value).toBe('cold')
    expect(deriveComfort(cat('outerwear'), mat('fleece')).value).toBe('cold')
    expect(deriveComfort(cat('top'), mat('down')).value).toBe('cold')

    // Rule 2: outerwear => cool
    expect(deriveComfort(cat('outerwear'), mat('synthetic')).value).toBe('cool')

    // Rule 3: denim or leather => cool
    expect(deriveComfort(cat('bottom'), mat('denim')).value).toBe('cool')
    expect(deriveComfort(cat('top'), mat('leather')).value).toBe('cool')

    // Rule 4: cotton or synthetic => mild
    expect(deriveComfort(cat('top'), mat('cotton')).value).toBe('mild')
    expect(deriveComfort(cat('bottom'), mat('synthetic')).value).toBe('mild')

    // Rule 5: silk => warm
    expect(deriveComfort(cat('dress'), mat('silk')).value).toBe('warm')

    // Rule 6: linen => hot
    expect(deriveComfort(cat('top'), mat('linen')).value).toBe('hot')
  })

  it('calculates comfort confidence as min of confident inputs or caps at 0.49 when unconfident', () => {
    const catConf = { value: 'top' as const, confidence: 0.84, isConfident: true }
    const matConf = { value: 'cotton' as const, confidence: 0.67, isConfident: true }
    const comfort1 = deriveComfort(catConf, matConf)
    expect(comfort1.confidence).toBe(0.67)
    expect(comfort1.isConfident).toBe(true)

    const matUnconf = { value: 'cotton' as const, confidence: 0.75, isConfident: false }
    const comfort2 = deriveComfort(catConf, matUnconf)
    expect(comfort2.confidence).toBeLessThanOrEqual(0.49)
    expect(comfort2.isConfident).toBe(false)
  })

  it('strictly gates FixtureGarmentTaggingEngine outside test environments', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('GARMENT_TAGGING_ENGINE', 'fixture')
    expect(() => new FixtureGarmentTaggingEngine()).toThrow('strictly forbidden')
  })
})
