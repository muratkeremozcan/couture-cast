import { InternalServerErrorException } from '@nestjs/common'
import {
  buildWardrobeObjectPath,
  buildWardrobeStagingObjectPath,
  isWardrobePathSegment,
  isWardrobeUuid,
  parseWardrobeObjectPath,
  type GarmentObjectExtension,
  type WardrobeObjectKind,
} from '@couture/utils'

import { createBaseLogger } from '../../logger/pino.config'
import type { GarmentMimeType } from './wardrobe-image-validation'

const logger = createBaseLogger().child({ feature: 'wardrobe-upload-paths' })

export function objectExtensionFor(mimeType: GarmentMimeType): GarmentObjectExtension {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  return 'webp'
}

function isGarmentMimeType(value: unknown): value is GarmentMimeType {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'
}

/** Where one upload session writes (`stagingPath`) and where commit publishes (`finalPath`). */
export type UploadSessionKeys = { stagingPath: string; finalPath: string }

/**
 * The keys of an upload session, derived from the row's own ids, or null when they cannot be
 * trusted: the owner id is not one key segment, the session id (or the garment id) is not a
 * UUID, the MIME type is not one the bucket takes, or the stored final path differs from the
 * derived one. The id columns are text and were member-writable before the 2026-11-19 revoke
 * migration, so a row that fails here is treated as an expired session and never reaches a
 * storage call.
 */
export function uploadSessionKeys(session: {
  kind: WardrobeObjectKind
  userId: string
  /** The garment id for a garment; the upload session id for My Form and the selfie. */
  objectId: string | null
  uploadSessionId: string | null
  mimeType: string | null
  storedObjectPath: string | null
}): UploadSessionKeys | null {
  const { kind, userId, objectId, uploadSessionId, mimeType, storedObjectPath } = session
  if (
    !isWardrobePathSegment(userId) ||
    !isWardrobeUuid(objectId) ||
    !isWardrobeUuid(uploadSessionId) ||
    !isGarmentMimeType(mimeType)
  ) {
    return null
  }
  const extension = objectExtensionFor(mimeType)
  const finalPath = buildWardrobeObjectPath(userId, kind, objectId, extension)
  if (storedObjectPath !== finalPath) {
    return null
  }
  return {
    stagingPath: buildWardrobeStagingObjectPath(userId, kind, uploadSessionId, extension),
    finalPath,
  }
}

/** Logs a session whose stored ids or path cannot be trusted; the caller answers it as expired. */
export function logUntrustedUploadSession(context: {
  operation: string
  kind: WardrobeObjectKind
  rowId: string
}): void {
  logger.error(context, 'wardrobe_upload_session_untrusted')
}

/**
 * True when `objectPath` is `userId`'s own final object of `kind` named `objectId` exactly (the
 * garment id, or the session id for My Form and the selfie), in any extension the bucket takes.
 */
export function isOwnSessionObject(
  objectPath: string | null | undefined,
  userId: string,
  kind: WardrobeObjectKind,
  objectId: string | null | undefined
): objectPath is string {
  if (!objectPath || !objectId) return false
  const parsed = parseWardrobeObjectPath(objectPath)
  return (
    parsed !== null &&
    parsed.userId === userId &&
    parsed.kind === kind &&
    parsed.objectId === objectId
  )
}

/**
 * True when `objectPath` is one of `userId`'s own final wardrobe objects of `kind`. Every
 * service-role storage call that takes a path from a row checks this first: before the
 * 2026-11-19 revoke migration a member could write their own row's path columns, and the
 * service role would then have read, moved or deleted whatever object those columns named.
 */
export function isOwnWardrobeObject(
  objectPath: string | null | undefined,
  userId: string,
  kind: WardrobeObjectKind
): objectPath is string {
  if (!objectPath) return false
  const parsed = parseWardrobeObjectPath(objectPath)
  return parsed !== null && parsed.userId === userId && parsed.kind === kind
}

/**
 * True when a garment row's `object_path` is that garment's own final object: this member's
 * folder, the garment kind, and the row's own id. Read paths that sign or download a garment
 * image skip any other path and log it, so an image is never served from another member's
 * object.
 */
export function isOwnGarmentObject(garment: {
  id: string
  user_id: string
  object_path: string | null
}): garment is { id: string; user_id: string; object_path: string } {
  if (!garment.object_path) return false
  const parsed = parseWardrobeObjectPath(garment.object_path)
  return (
    parsed !== null &&
    parsed.kind === 'garment' &&
    parsed.userId === garment.user_id &&
    parsed.objectId === garment.id
  )
}

/**
 * The refusal when a row's stored path is not the one the service derives from the row
 * itself. It is a server error, never the member's fault to fix, and it is raised before any
 * storage call. The path is not logged: it can carry another member's id.
 */
export function uploadPathInvalid(context: {
  operation: string
  kind: WardrobeObjectKind
  rowId: string
}): InternalServerErrorException {
  logger.error(context, 'wardrobe_upload_path_invalid')
  return new InternalServerErrorException('UPLOAD_PATH_INVALID')
}

/**
 * The objects a replaced, deleted or erased My Form or selfie session can leave, limited to what
 * the row's ids can vouch for: the final object when it parses as this member's own object of
 * `kind` with a UUID object id that is the row's session (or the row's session was already
 * cleared by an enqueue rollback), and the staging key when the session id and MIME type are
 * valid. Anything else is skipped and logged, never removed on the row's word.
 */
export function ownSessionObjectsToRemove(session: {
  kind: Exclude<WardrobeObjectKind, 'garment'>
  rowId: string
  userId: string
  uploadSessionId: string | null
  mimeType: string | null
  storedObjectPath: string | null
}): string[] {
  const { kind, rowId, userId, uploadSessionId, mimeType, storedObjectPath } = session
  const paths: string[] = []
  if (storedObjectPath) {
    const parsed = parseWardrobeObjectPath(storedObjectPath)
    if (
      parsed !== null &&
      parsed.userId === userId &&
      parsed.kind === kind &&
      isWardrobeUuid(parsed.objectId) &&
      (uploadSessionId === null || parsed.objectId === uploadSessionId)
    ) {
      paths.push(storedObjectPath)
    } else {
      logger.error({ kind, rowId }, 'wardrobe_object_path_not_own_skipped')
    }
  }
  if (
    isWardrobePathSegment(userId) &&
    isWardrobeUuid(uploadSessionId) &&
    isGarmentMimeType(mimeType)
  ) {
    paths.push(
      buildWardrobeStagingObjectPath(
        userId,
        kind,
        uploadSessionId,
        objectExtensionFor(mimeType)
      )
    )
  }
  return paths
}
