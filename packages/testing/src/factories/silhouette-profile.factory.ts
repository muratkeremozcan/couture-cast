import type {
  GarmentRetentionStatus,
  Prisma,
  PrismaClient,
  SilhouetteMode,
  SilhouettePhotoFailureReason,
  SilhouettePhotoStatus,
  SilhouetteProfile,
} from '@prisma/client'
import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export interface SilhouetteProfileFixture {
  id: string
  userId: string
  mode: SilhouetteMode
  heightSlider: number | null
  buildSlider: number | null
  myFormObjectPath: string | null
  myFormUploadSessionId: string | null
  myFormUploadIdempotencyKey: string | null
  myFormCommitIdempotencyKey: string | null
  myFormCommitPayloadHash: string | null
  myFormFileSizeBytes: number | null
  myFormMimeType: string | null
  myFormContentSha256: string | null
  myFormWidthPx: number | null
  myFormHeightPx: number | null
  myFormUploadExpiresAt: Date | null
  myFormCommittedAt: Date | null
  myFormConsentCheckedAt: Date | null
  myFormStatus: SilhouettePhotoStatus | null
  myFormFailureReason: SilhouettePhotoFailureReason | null
  myFormModerationFlaggedAt: Date | null
  myFormRetentionStatus: GarmentRetentionStatus
  revision: number
  createdAt: Date
  updatedAt: Date
}

export type SilhouetteProfileFactoryOverrides = Partial<SilhouetteProfileFixture>

type PersistSilhouetteProfilePrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedSilhouetteProfileOptions {
  persist: true
  prisma: PersistSilhouetteProfilePrismaClient
}

export type PersistedSilhouetteProfileFixture = SilhouetteProfile

const mergeSilhouetteProfileFixture = createFactory<SilhouetteProfileFixture>(
  buildDefaultSilhouetteProfileFixture
)

function buildDefaultSilhouetteProfileFixture(): SilhouetteProfileFixture {
  const now = new Date()

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myFormObjectPath: null,
    myFormUploadSessionId: null,
    myFormUploadIdempotencyKey: null,
    myFormCommitIdempotencyKey: null,
    myFormCommitPayloadHash: null,
    myFormFileSizeBytes: null,
    myFormMimeType: null,
    myFormContentSha256: null,
    myFormWidthPx: null,
    myFormHeightPx: null,
    myFormUploadExpiresAt: null,
    myFormCommittedAt: null,
    myFormConsentCheckedAt: null,
    myFormStatus: null,
    myFormFailureReason: null,
    myFormModerationFlaggedAt: null,
    myFormRetentionStatus: 'active',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** A silhouette profile whose "My Form" photo has finished processing. */
export function buildReadyMyFormOverrides(
  userId: string
): SilhouetteProfileFactoryOverrides {
  return {
    userId,
    mode: 'my_form',
    myFormObjectPath: `wardrobe/${userId}/silhouette/${faker.string.uuid()}.jpg`,
    myFormStatus: 'ready',
    myFormFailureReason: null,
    myFormCommittedAt: new Date(),
  }
}

export async function persistSilhouetteProfile(
  prisma: PersistSilhouetteProfilePrismaClient,
  fixture: SilhouetteProfileFixture
): Promise<PersistedSilhouetteProfileFixture> {
  const profile = await prisma.silhouetteProfile.create({
    data: {
      id: fixture.id,
      user_id: fixture.userId,
      mode: fixture.mode,
      height_slider: fixture.heightSlider,
      build_slider: fixture.buildSlider,
      my_form_object_path: fixture.myFormObjectPath,
      my_form_upload_session_id: fixture.myFormUploadSessionId,
      my_form_upload_idempotency_key: fixture.myFormUploadIdempotencyKey,
      my_form_commit_idempotency_key: fixture.myFormCommitIdempotencyKey,
      my_form_commit_payload_hash: fixture.myFormCommitPayloadHash,
      my_form_file_size_bytes: fixture.myFormFileSizeBytes,
      my_form_mime_type: fixture.myFormMimeType,
      my_form_content_sha256: fixture.myFormContentSha256,
      my_form_width_px: fixture.myFormWidthPx,
      my_form_height_px: fixture.myFormHeightPx,
      my_form_upload_expires_at: fixture.myFormUploadExpiresAt,
      my_form_committed_at: fixture.myFormCommittedAt,
      my_form_consent_checked_at: fixture.myFormConsentCheckedAt,
      my_form_status: fixture.myFormStatus,
      my_form_failure_reason: fixture.myFormFailureReason,
      my_form_moderation_flagged_at: fixture.myFormModerationFlaggedAt,
      my_form_retention_status: fixture.myFormRetentionStatus,
      revision: fixture.revision,
    },
  })

  registerCreatedEntity('silhouetteProfiles', profile.id)

  return profile
}

function maybePersistSilhouetteProfile(
  fixture: SilhouetteProfileFixture,
  options?: CreatePersistedSilhouetteProfileOptions
): SilhouetteProfileFixture | Promise<PersistedSilhouetteProfileFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistSilhouetteProfile(options.prisma, fixture)
}

export function createSilhouetteProfile(
  overrides?: SilhouetteProfileFactoryOverrides
): SilhouetteProfileFixture
export function createSilhouetteProfile(
  overrides: SilhouetteProfileFactoryOverrides | undefined,
  options: CreatePersistedSilhouetteProfileOptions
): Promise<PersistedSilhouetteProfileFixture>
export function createSilhouetteProfile(
  overrides: SilhouetteProfileFactoryOverrides = {},
  options?: CreatePersistedSilhouetteProfileOptions
): SilhouetteProfileFixture | Promise<PersistedSilhouetteProfileFixture> {
  return maybePersistSilhouetteProfile(mergeSilhouetteProfileFixture(overrides), options)
}
