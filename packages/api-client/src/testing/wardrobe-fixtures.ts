import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  type GarmentItemContract,
  type GarmentTagSuggestionSnapshot,
  type SuggestGarmentTagsData,
} from '../contracts/http/wardrobe'

const FIXED_CREATED_AT = '2026-08-05T10:00:00.000Z'
const FIXED_COMMITTED_AT = '2026-08-05T10:01:00.000Z'
const FIXED_CONFIRMED_AT = '2026-08-05T12:00:00.000Z'
const FIXED_IMAGE_EXPIRY = '2026-08-05T12:15:00.000Z'

type SuggestionOverrides = {
  analysisVersion?: GarmentTagSuggestionSnapshot['analysisVersion']
  category?: Partial<GarmentTagSuggestionSnapshot['category']>
  material?: Partial<GarmentTagSuggestionSnapshot['material']>
  comfortRange?: Partial<GarmentTagSuggestionSnapshot['comfortRange']>
}

export function createGarmentTagSuggestionSnapshotFixture(
  overrides: SuggestionOverrides = {}
): GarmentTagSuggestionSnapshot {
  return {
    analysisVersion: overrides.analysisVersion ?? GARMENT_TAGGING_ANALYSIS_VERSION,
    category: {
      value: 'top',
      confidence: 0.85,
      isConfident: true,
      ...overrides.category,
    },
    material: {
      value: 'cotton',
      confidence: 0.72,
      isConfident: true,
      ...overrides.material,
    },
    comfortRange: {
      value: 'mild',
      confidence: 0.72,
      isConfident: true,
      ...overrides.comfortRange,
    },
  }
}

export function createSuggestGarmentTagsDataFixture(
  overrides: SuggestionOverrides & { garmentId?: string } = {}
): SuggestGarmentTagsData {
  const snapshot = createGarmentTagSuggestionSnapshotFixture(overrides)
  return {
    garmentId: overrides.garmentId ?? 'garment-1',
    analysisVersion: snapshot.analysisVersion,
    suggestions: {
      category: snapshot.category,
      material: snapshot.material,
      comfortRange: snapshot.comfortRange,
    },
  }
}

export function createReadyGarmentFixture(
  overrides: Partial<GarmentItemContract> = {}
): GarmentItemContract {
  return {
    id: 'garment-1',
    status: 'ready',
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: FIXED_CONFIRMED_AT,
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: FIXED_CREATED_AT,
    committedAt: FIXED_COMMITTED_AT,
    imageAccess: {
      url: 'https://example.test/garment.png',
      expiresAt: FIXED_IMAGE_EXPIRY,
    },
    ...overrides,
  }
}
