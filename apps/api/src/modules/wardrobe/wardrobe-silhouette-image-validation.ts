// Story 4.4 Task 4: "My Form" photo validation, mirroring wardrobe-image-validation.ts
// with an added portrait-framing constraint.
import { createHash } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import type {
  GarmentImageDeclaration,
  GarmentMimeType,
} from './wardrobe-image-validation'
import { GarmentImageValidationError } from './wardrobe-image-validation'

export const MAX_SILHOUETTE_PHOTO_BYTES = 10_485_760
export const MIN_SILHOUETTE_PHOTO_DIMENSION = 256
export const MAX_SILHOUETTE_PHOTO_DIMENSION = 4096
/** A full-body photo must be noticeably taller than it is wide. */
export const MIN_SILHOUETTE_ASPECT_RATIO = 1.2

export type SilhouettePhotoDeclaration = GarmentImageDeclaration
export type VerifiedSilhouettePhoto = SilhouettePhotoDeclaration & {
  format: 'jpeg' | 'png' | 'webp'
}

function detectMimeType(bytes: Buffer): GarmentMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function expectedSharpFormat(mimeType: GarmentMimeType) {
  return mimeType === 'image/jpeg' ? 'jpeg' : mimeType.slice('image/'.length)
}

function validateDeclaredPayload(
  bytes: Buffer,
  declaration: SilhouettePhotoDeclaration
): void {
  if (
    bytes.length < 1 ||
    bytes.length > MAX_SILHOUETTE_PHOTO_BYTES ||
    bytes.length !== declaration.fileSizeBytes
  ) {
    throw new GarmentImageValidationError('IMAGE_SIZE_MISMATCH')
  }
  if (detectMimeType(bytes) !== declaration.mimeType) {
    throw new GarmentImageValidationError('UNSUPPORTED_IMAGE_TYPE')
  }
  const checksum = createHash('sha256').update(bytes).digest('hex')
  if (checksum !== declaration.sha256) {
    throw new GarmentImageValidationError('IMAGE_CHECKSUM_MISMATCH')
  }
}

function validateDecodedMetadata(
  metadata: Metadata,
  declaration: SilhouettePhotoDeclaration
): void {
  if (
    metadata.format !== expectedSharpFormat(declaration.mimeType) ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new GarmentImageValidationError('IMAGE_DECODE_FAILED')
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < MIN_SILHOUETTE_PHOTO_DIMENSION ||
    metadata.height < MIN_SILHOUETTE_PHOTO_DIMENSION ||
    metadata.width > MAX_SILHOUETTE_PHOTO_DIMENSION ||
    metadata.height > MAX_SILHOUETTE_PHOTO_DIMENSION ||
    metadata.width !== declaration.widthPx ||
    metadata.height !== declaration.heightPx
  ) {
    throw new GarmentImageValidationError('IMAGE_DIMENSIONS_INVALID')
  }
  if (metadata.height < metadata.width * MIN_SILHOUETTE_ASPECT_RATIO) {
    throw new GarmentImageValidationError('IMAGE_NOT_PORTRAIT_FRAMED')
  }
}

export async function verifySilhouettePhoto(
  bytes: Buffer,
  declaration: SilhouettePhotoDeclaration
): Promise<VerifiedSilhouettePhoto> {
  validateDeclaredPayload(bytes, declaration)

  try {
    const image = sharp(bytes, {
      animated: true,
      failOn: 'error',
      limitInputPixels: MAX_SILHOUETTE_PHOTO_DIMENSION * MAX_SILHOUETTE_PHOTO_DIMENSION,
      sequentialRead: true,
    })
    const metadata = await image.metadata()
    validateDecodedMetadata(metadata, declaration)

    await image.stats()

    return {
      ...declaration,
      format: metadata.format as VerifiedSilhouettePhoto['format'],
    }
  } catch (error) {
    if (error instanceof GarmentImageValidationError) {
      throw error
    }
    throw new GarmentImageValidationError('IMAGE_DECODE_FAILED')
  }
}
