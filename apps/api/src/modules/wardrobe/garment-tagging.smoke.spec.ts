import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { garmentTagSuggestionSnapshotSchema } from '@couture/api-client/contracts/http'
import {
  initializeInferenceWorker,
  runInferenceOnImage,
} from './fashion-clip-inference.worker'
import {
  ANALYSIS_VERSION,
  classifyCategory,
  classifyMaterial,
  deriveComfort,
} from './garment-tagging.engine'

describe('Garment Tagging Model Smoke Test', () => {
  it('processes a neutral garment fixture and returns valid finite schema output', async () => {
    const fixturePath = path.resolve(
      __dirname,
      '../../../test/fixtures/garment-tagging/neutral-top.png'
    )
    const modelDir = path.resolve(__dirname, '../../../.cache/garment-tagging-model')
    expect(fs.existsSync(fixturePath)).toBe(true)
    expect(fs.existsSync(modelDir)).toBe(true)

    const buffer = fs.readFileSync(fixturePath)
    expect(buffer.length).toBeGreaterThan(0)

    await initializeInferenceWorker(modelDir)
    const logits = await runInferenceOnImage(buffer)
    const category = classifyCategory(logits.categoryLogits)
    const material = classifyMaterial(logits.materialLogits)
    const result = {
      analysisVersion: ANALYSIS_VERSION,
      category,
      material,
      comfortRange: deriveComfort(category, material),
    }

    const parsed = garmentTagSuggestionSnapshotSchema.parse(result)

    expect(parsed.analysisVersion).toBe(ANALYSIS_VERSION)
    expect(parsed.category.value).toBeDefined()
    expect(parsed.category.confidence).toBeGreaterThanOrEqual(0)
    expect(parsed.category.confidence).toBeLessThanOrEqual(1)
    expect(parsed.material.value).toBeDefined()
    expect(parsed.comfortRange.value).toBeDefined()
  })
})
