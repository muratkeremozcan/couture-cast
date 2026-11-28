import { Inject, Injectable } from '@nestjs/common'
import type { PhotoAiInputClass } from '@couture/api-client/contracts/http'
import { isWardrobePathSegment, parseCommunityObjectPath } from '@couture/utils'
import type { Prisma } from '@prisma/client'
import { SupabaseCommunityStorageAdapter } from '../community/community-storage.adapter.js'
import {
  MAX_GARMENT_IMAGE_BYTES,
  type GarmentMimeType,
} from '../wardrobe/wardrobe-image-validation.js'
import { SupabaseWardrobeStorageAdapter } from '../wardrobe/wardrobe-storage.adapter.js'
import { isOwnGarmentObject } from '../wardrobe/wardrobe-upload-paths.js'

export type PhotoAiSource = Readonly<{
  memberId: string
  photoId: string
  inputClass: PhotoAiInputClass
  objectPath: string
  mimeType: GarmentMimeType
  byteSize: number
  sha256: string
}>

type SourceRow = {
  id: string
  user_id: string
  object_path: string | null
  mime_type: string | null
  byte_size: number | null
  sha256: string | null
}

function ownedCommunityObject(row: SourceRow): boolean {
  const parsed = row.object_path ? parseCommunityObjectPath(row.object_path) : null
  return (
    !!parsed &&
    parsed.postId === row.id &&
    isWardrobePathSegment(parsed.postId) &&
    isWardrobePathSegment(parsed.uploadSessionId) &&
    ['jpg', 'jpeg', 'png', 'webp'].includes(parsed.extension)
  )
}

function validDeclaration(row: SourceRow): row is SourceRow & {
  object_path: string
  mime_type: GarmentMimeType
  byte_size: number
  sha256: string
} {
  return (
    !!row.object_path &&
    (row.mime_type === 'image/jpeg' ||
      row.mime_type === 'image/png' ||
      row.mime_type === 'image/webp') &&
    row.byte_size !== null &&
    row.byte_size > 0 &&
    row.byte_size <= MAX_GARMENT_IMAGE_BYTES &&
    !!row.sha256 &&
    /^[a-f0-9]{64}$/.test(row.sha256)
  )
}

@Injectable()
export class PhotoAiSourceService {
  constructor(
    @Inject(SupabaseCommunityStorageAdapter)
    private readonly community: Pick<SupabaseCommunityStorageAdapter, 'downloadBounded'>,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly wardrobe: Pick<SupabaseWardrobeStorageAdapter, 'downloadBounded'>
  ) {}

  async resolve(
    tx: Prisma.TransactionClient,
    memberId: string,
    inputClass: PhotoAiInputClass,
    photoId: string
  ): Promise<PhotoAiSource | null> {
    let row: SourceRow | undefined
    if (inputClass === 'community-photo') {
      const [community] = await tx.$queryRaw<SourceRow[]>`
        SELECT "id", "user_id", "image_object_path" AS "object_path",
          "image_content_type" AS "mime_type", "image_byte_size" AS "byte_size", "image_checksum" AS "sha256"
        FROM "LookbookPost" WHERE "id" = ${photoId} AND "user_id" = ${memberId}
          AND ("status" IN ('pending_review', 'published') OR
            ("status" = 'draft' AND "upload_expires_at" > clock_timestamp()))
          AND "image_pending_checksum" IS NULL AND "image_pending_byte_size" IS NULL
          AND "erasure_requested_at" IS NULL AND "anonymized_at" IS NULL AND "objects_purged_at" IS NULL
        FOR SHARE
      `
      if (!community || !ownedCommunityObject(community)) return null
      row = community
    } else if (inputClass === 'garment-photo') {
      const [garment] = await tx.$queryRaw<SourceRow[]>`
        SELECT "id", "user_id", "object_path", "mime_type",
          "file_size_bytes" AS "byte_size", "content_sha256" AS "sha256"
        FROM "GarmentItem" WHERE "id" = ${photoId} AND "user_id" = ${memberId}
          AND "committed_at" IS NOT NULL AND "retention_status" = 'active'
          AND "deletion_requested_at" IS NULL
          AND "upload_status" IN ('processing', 'awaiting_tags', 'ready')
        FOR SHARE
      `
      if (!garment || !isOwnGarmentObject(garment)) return null
      row = garment
    } else {
      // Flat-lay staging acquires its own source authorization in CC-7.29.
      return null
    }
    if (!validDeclaration(row)) return null
    return {
      memberId: row.user_id,
      photoId: row.id,
      inputClass,
      objectPath: row.object_path,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
    }
  }

  /** The caller owns and clears the returned buffer. */
  async read(source: PhotoAiSource, signal: AbortSignal): Promise<Buffer | null> {
    if (source.inputClass === 'community-photo') {
      return this.community.downloadBounded(source.objectPath, source.byteSize, signal)
    }
    if (source.inputClass === 'garment-photo') {
      const result = await this.wardrobe.downloadBounded(
        source.objectPath,
        source.byteSize,
        signal
      )
      return result.status === 'present' ? result.bytes : null
    }
    return null
  }
}
