// Step 15 step 4 owner:
// re-export the stable package surface here so apps do not import generated internals directly.
export {
  garmentCategoryEnum,
  garmentMaterialEnum,
  garmentComfortRangeEnum,
  GARMENT_TAGGING_ANALYSIS_VERSION,
  garmentTagSuggestionSnapshotSchema,
  garmentListResponseSchema,
  suggestGarmentTagsDataSchema,
  suggestGarmentTagsResponseSchema,
  updateGarmentTagsInputSchema,
  updateGarmentTagsResponseSchema,
  type GarmentItemContract,
  type SuggestGarmentTagsData,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
} from './contracts/http/wardrobe'
export * from './generated'
export { createApiClient } from './client'
export type { ApiClientAccessToken, ApiClientOptions } from './client'
export * from './types/analytics-events'
export * from './types/deep-link-targets'
export * from './types/socket-events'
export * from './realtime/polling-service'
