import {
  GarmentTaggingManualModeError,
  type GarmentTaggingEngine,
} from './garment-tagging.engine'
import type { GarmentTagSuggestionSnapshot } from '@couture/api-client/contracts/http'

/**
 * `GARMENT_TAGGING_ENGINE=manual`: no model, no suggestions. Imports nothing heavy on purpose, so
 * a worker that selects it never loads onnxruntime or transformers (the hosted wardrobe worker
 * runs on a 512 MB service that cannot hold the model). The processor turns the thrown error into
 * `tagging_failure_code = TAGGING_MANUAL_MODE` and moves the garment to `awaiting_tags`.
 */
export class ManualGarmentTaggingEngine implements GarmentTaggingEngine {
  inferTags(_imageBuffer: Buffer): Promise<GarmentTagSuggestionSnapshot> {
    void _imageBuffer
    return Promise.reject(new GarmentTaggingManualModeError())
  }
}
