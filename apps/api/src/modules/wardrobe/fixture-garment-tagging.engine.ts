// Story 4.2 Task 2 step 3 owner: implement FixtureGarmentTaggingEngine fallback engine in apps/api/src/modules/wardrobe/fixture-garment-tagging.engine.ts
import type { GarmentTagSuggestionSnapshot } from '@couture/api-client/contracts/http'
import { allowsTestOnlySecrets } from '../../config/runtime-environment'
import {
  ANALYSIS_VERSION,
  classifyCategory,
  classifyMaterial,
  deriveComfort,
  type GarmentTaggingEngine,
} from './garment-tagging.engine'

export class FixtureGarmentTaggingEngine implements GarmentTaggingEngine {
  constructor() {
    if (process.env.GARMENT_TAGGING_ENGINE !== 'fixture' || !allowsTestOnlySecrets()) {
      throw new Error(
        'FixtureGarmentTaggingEngine is strictly forbidden outside an allowed test environment'
      )
    }
  }

  inferTags(_imageBuffer: Buffer): Promise<GarmentTagSuggestionSnapshot> {
    void _imageBuffer
    // Deterministic top/cotton/mild fixture logits
    const categoryLogits = [2.5, 0.1, 0.1, 0.1, 0.1, 0.1]
    const materialLogits = [2.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]

    const category = classifyCategory(categoryLogits)
    const material = classifyMaterial(materialLogits)
    const comfortRange = deriveComfort(category, material)

    return Promise.resolve({
      analysisVersion: ANALYSIS_VERSION,
      category,
      material,
      comfortRange,
    })
  }
}
