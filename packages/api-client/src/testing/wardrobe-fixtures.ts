import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  type GarmentItemContract,
  type GarmentTagSuggestionSnapshot,
  type OutfitCapsuleContract,
  type SilhouetteProfileContract,
  type SuggestGarmentTagsData,
  type WardrobeOnboardingStateContract,
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

export function createOutfitCapsuleFixture(
  overrides: Partial<OutfitCapsuleContract> = {}
): OutfitCapsuleContract {
  return {
    id: 'capsule-1',
    ownerUserId: 'user-1',
    name: 'Work Capsule',
    description: 'Essential office outfits',
    occasions: ['work', 'casual'],
    isFavorite: false,
    revision: 1,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [
      {
        id: 'garment-1',
        category: 'top',
        material: 'cotton',
        comfortRange: 'mild',
        imageAccess: {
          url: 'https://example.test/garment-1.png',
          expiresAt: FIXED_IMAGE_EXPIRY,
        },
        availabilityStatus: 'ready',
        garmentOrder: 0,
      },
      {
        id: 'garment-2',
        category: 'bottom',
        material: 'denim',
        comfortRange: 'mild',
        imageAccess: {
          url: 'https://example.test/garment-2.png',
          expiresAt: FIXED_IMAGE_EXPIRY,
        },
        availabilityStatus: 'ready',
        garmentOrder: 1,
      },
    ],
    createdAt: FIXED_CREATED_AT,
    updatedAt: FIXED_COMMITTED_AT,
    ...overrides,
  }
}

/**
 * `WardrobeOnboardingStateContract` is a discriminated union, so a builder
 * accepting `Partial<Union>` cannot be type-safe: spreading arbitrary overrides
 * onto one variant widens the result into something that is no longer any valid
 * variant. Each builder is therefore pinned to the variant it produces, which is
 * also what stops a fixture from expressing an impossible state.
 */
type WardrobeOnboardingStateOf<
  TStatus extends WardrobeOnboardingStateContract['status'],
> = Extract<WardrobeOnboardingStateContract, { status: TStatus }>

export function createWardrobeOnboardingStateFixture(
  overrides: Partial<WardrobeOnboardingStateOf<'in_progress'>> = {}
): WardrobeOnboardingStateOf<'in_progress'> {
  return {
    status: 'in_progress',
    currentStep: 'silhouette',
    usedStarterWardrobe: false,
    garmentsCapturedCount: 1,
    startedAt: FIXED_CREATED_AT,
    completedAt: null,
    revision: 1,
    ...overrides,
  }
}

export function createNotStartedOnboardingStateFixture(): WardrobeOnboardingStateOf<'not_started'> {
  return {
    status: 'not_started',
    currentStep: 'permission',
    usedStarterWardrobe: false,
    garmentsCapturedCount: 0,
    startedAt: null,
    completedAt: null,
    revision: 0,
  }
}

export function createCompletedOnboardingStateFixture(
  overrides: Partial<WardrobeOnboardingStateOf<'completed'>> = {}
): WardrobeOnboardingStateOf<'completed'> {
  return {
    status: 'completed',
    currentStep: 'complete',
    usedStarterWardrobe: false,
    garmentsCapturedCount: 3,
    startedAt: FIXED_CREATED_AT,
    completedAt: FIXED_COMMITTED_AT,
    revision: 4,
    ...overrides,
  }
}

export function createSilhouetteProfileFixture(
  overrides: Partial<SilhouetteProfileContract> = {}
): SilhouetteProfileContract {
  return {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 1,
    updatedAt: FIXED_COMMITTED_AT,
    ...overrides,
  }
}

export function createReadyMyFormSilhouetteProfileFixture(
  overrides: Partial<SilhouetteProfileContract> = {}
): SilhouetteProfileContract {
  return createSilhouetteProfileFixture({
    mode: 'my_form',
    myForm: {
      status: 'ready',
      failureReason: null,
      committedAt: FIXED_COMMITTED_AT,
      imageAccess: {
        url: 'https://example.test/silhouette-my-form.png',
        expiresAt: FIXED_IMAGE_EXPIRY,
      },
    },
    ...overrides,
  })
}
