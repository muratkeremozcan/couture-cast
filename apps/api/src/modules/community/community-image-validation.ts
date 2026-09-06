import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  GarmentImageValidationError,
  MAX_GARMENT_IMAGE_BYTES,
  MAX_GARMENT_IMAGE_DIMENSION,
  MIN_GARMENT_IMAGE_DIMENSION,
  type GarmentMimeType,
} from '../wardrobe/wardrobe-image-validation.js'

export {
  GarmentImageValidationError as CommunityImageValidationError,
  type GarmentMimeType as CommunityMimeType,
}

export const MAX_COMMUNITY_IMAGE_BYTES = MAX_GARMENT_IMAGE_BYTES
export const MIN_COMMUNITY_IMAGE_DIMENSION = MIN_GARMENT_IMAGE_DIMENSION
export const MAX_COMMUNITY_IMAGE_DIMENSION = MAX_GARMENT_IMAGE_DIMENSION

export interface CommunityImageDeclaration {
  byteSize: number
  mimeType: GarmentMimeType
  sha256: string
}

export interface NormalizedCommunityImage {
  bytes: Buffer
  byteSize: number
  sha256: string
  mimeType: GarmentMimeType
  widthPx: number
  heightPx: number
}

const SHARP_FORMAT_BY_MIME: Record<GarmentMimeType, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
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

/**
 * Size, sniffed MIME and checksum, in that order. Returns the SNIFFED type so
 * the caller re-encodes to what the bytes actually are rather than to what the
 * client claimed they were.
 */
function verifyDeclaration(
  bytes: Buffer,
  declaration: CommunityImageDeclaration
): GarmentMimeType {
  if (
    bytes.length < 1 ||
    bytes.length > MAX_COMMUNITY_IMAGE_BYTES ||
    bytes.length !== declaration.byteSize
  ) {
    throw new GarmentImageValidationError('IMAGE_SIZE_MISMATCH')
  }

  const sniffedMime = detectMimeType(bytes)
  if (!sniffedMime || sniffedMime !== declaration.mimeType) {
    throw new GarmentImageValidationError('UNSUPPORTED_IMAGE_TYPE')
  }

  if (createHash('sha256').update(bytes).digest('hex') !== declaration.sha256) {
    throw new GarmentImageValidationError('IMAGE_CHECKSUM_MISMATCH')
  }

  return sniffedMime
}

function assertDimensionsInRange(width: number, height: number): void {
  if (
    width < MIN_COMMUNITY_IMAGE_DIMENSION ||
    height < MIN_COMMUNITY_IMAGE_DIMENSION ||
    width > MAX_COMMUNITY_IMAGE_DIMENSION ||
    height > MAX_COMMUNITY_IMAGE_DIMENSION
  ) {
    throw new GarmentImageValidationError('IMAGE_DIMENSIONS_INVALID')
  }
}

/**
 * Verifies the uploaded bytes against what the client declared at allocate time,
 * then orients, decodes and re-encodes them.
 *
 * NOTHING VERIFIED THE UPLOAD BEFORE THIS. The bytes were never fetched for
 * validation, the MIME type was never sniffed, and the declared `sha256` was
 * persisted verbatim from the request body — so a client could declare a small
 * JPEG and upload anything at all, and the stored checksum would describe a file
 * that was never uploaded. The wardrobe module has verified its uploads this way
 * since story 4.1; this is the same discipline applied to the public feed, where
 * the stakes are higher because the object is served to every viewer.
 *
 * The re-encode is not cosmetic. `sharp().rotate()` bakes the EXIF orientation
 * into the pixels and drops the metadata block, which removes both the
 * orientation trap (an image that renders differently in the moderation worker
 * than in a browser) and any GPS or device identifiers the author's camera
 * attached. The checksum and byte size returned here describe the re-encoded
 * object and are what should be persisted, replacing the client's declaration.
 */
export async function verifyAndNormalizeCommunityImage(
  bytes: Buffer,
  declaration: CommunityImageDeclaration
): Promise<NormalizedCommunityImage> {
  const sniffedMime = verifyDeclaration(bytes, declaration)

  try {
    const format = SHARP_FORMAT_BY_MIME[sniffedMime]
    const pipeline = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: MAX_COMMUNITY_IMAGE_DIMENSION * MAX_COMMUNITY_IMAGE_DIMENSION,
      sequentialRead: true,
    })

    const metadata = await pipeline.metadata()
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) {
      throw new GarmentImageValidationError('IMAGE_DECODE_FAILED')
    }

    const { data, info } = await pipeline
      .rotate()
      .toFormat(format)
      .toBuffer({ resolveWithObject: true })

    assertDimensionsInRange(info.width, info.height)

    return {
      bytes: data,
      byteSize: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      mimeType: sniffedMime,
      widthPx: info.width,
      heightPx: info.height,
    }
  } catch (error) {
    if (error instanceof GarmentImageValidationError) {
      throw error
    }
    throw new GarmentImageValidationError('IMAGE_DECODE_FAILED')
  }
}
