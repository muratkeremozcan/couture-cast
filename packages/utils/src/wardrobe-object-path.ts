export type GarmentObjectExtension = 'jpg' | 'png' | 'webp'

export type WardrobeObjectKind = 'garment' | 'silhouette' | 'palette'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * True for an RFC 4122 shaped UUID. Upload session ids and API-allocated garment ids are
 * `randomUUID()` values; a stored id that is not one was written by something else (the id
 * columns are text and were member-writable before the 2026-11-19 revoke migration), so it
 * never enters a storage key.
 */
export function isWardrobeUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * True for an id that can stand as one key segment: letters, digits, `_` and `-` only, so it
 * can neither add a folder nor climb out of one. User ids pass through this rather than the
 * UUID check, since seeded and load-test accounts use readable ids; a user id always comes
 * from the verified access token or the row's owner column, never from a member-written field.
 */
export function isWardrobePathSegment(value: unknown): value is string {
  return typeof value === 'string' && PATH_SEGMENT_PATTERN.test(value)
}

function segment(value: string, name: string): string {
  if (!isWardrobePathSegment(value)) {
    throw new Error(`WARDROBE_KEY_${name}_INVALID`)
  }
  return value
}

function uuid(value: string, name: string): string {
  if (!isWardrobeUuid(value)) {
    throw new Error(`WARDROBE_KEY_${name}_INVALID`)
  }
  return value
}

export function buildGarmentObjectPath(
  userId: string,
  garmentId: string,
  extension: GarmentObjectExtension
): string {
  return `wardrobe/${segment(userId, 'USER')}/${segment(garmentId, 'OBJECT')}.${extension}`
}

/** Story 4.4: "My Form" photos live in the same bucket/user folder as
 * garments, under a silhouette/ prefix, so the existing storage RLS policy
 * (keyed on the folder's user_id path segment) already authorizes them. */
export function buildSilhouetteObjectPath(
  userId: string,
  uploadSessionId: string,
  extension: GarmentObjectExtension
): string {
  return `wardrobe/${segment(userId, 'USER')}/silhouette/${segment(uploadSessionId, 'OBJECT')}.${extension}`
}

/** Story 5.4: palette advisor selfies, same bucket/user folder convention as
 * silhouette photos, under a palette/ prefix. The object is purged the
 * moment analysis terminates (Decision 8) — this path never outlives one
 * analysis attempt. */
export function buildPaletteSelfieObjectPath(
  userId: string,
  uploadSessionId: string,
  extension: GarmentObjectExtension
): string {
  return `wardrobe/${segment(userId, 'USER')}/palette/${segment(uploadSessionId, 'OBJECT')}.${extension}`
}

/** The final-path builder for each kind; the object id is the garment id or the session id. */
export function buildWardrobeObjectPath(
  userId: string,
  kind: WardrobeObjectKind,
  objectId: string,
  extension: GarmentObjectExtension
): string {
  if (kind === 'silhouette') return buildSilhouetteObjectPath(userId, objectId, extension)
  if (kind === 'palette') return buildPaletteSelfieObjectPath(userId, objectId, extension)
  return buildGarmentObjectPath(userId, objectId, extension)
}

/** The top folder every wardrobe-images signed upload URL writes into. */
export const WARDROBE_STAGING_FOLDER = 'staging'

/**
 * Where a client PUTs the bytes of a garment, My Form photo or palette selfie upload:
 * `staging/<userId>/<kind>/<uploadSessionId>.<ext>`. Signed upload URLs only ever name a key
 * like this, never a final path: a signed write outlives the row it was issued for (storage
 * tokens live 2 hours), so a final path that was deleted, replaced or purged could otherwise be
 * written again. Commit verifies the staged bytes and the server itself writes them to the
 * final path. The bucket's read policy only admits keys under `wardrobe/`, so no member,
 * guardian, admin or moderator can read a staged upload. The session id must be a UUID.
 */
export function buildWardrobeStagingObjectPath(
  userId: string,
  kind: WardrobeObjectKind,
  uploadSessionId: string,
  extension: GarmentObjectExtension
): string {
  return `${WARDROBE_STAGING_FOLDER}/${segment(userId, 'USER')}/${kind}/${uuid(uploadSessionId, 'SESSION')}.${extension}`
}

/** Inverse of {@link buildWardrobeStagingObjectPath}; null for any other path. */
export function parseWardrobeStagingObjectPath(objectPath: string): {
  userId: string
  kind: WardrobeObjectKind
  uploadSessionId: string
  extension: GarmentObjectExtension
} | null {
  const match =
    /^staging\/([A-Za-z0-9_-]{1,128})\/(garment|silhouette|palette)\/([^/]+)\.(jpg|png|webp)$/.exec(
      objectPath
    )
  const userId = match?.[1]
  const kind = match?.[2] as WardrobeObjectKind | undefined
  const uploadSessionId = match?.[3]
  const extension = match?.[4] as GarmentObjectExtension | undefined
  if (!userId || !kind || !isWardrobeUuid(uploadSessionId) || !extension) {
    return null
  }
  return { userId, kind, uploadSessionId, extension }
}

/** The top folder of server-written copies of staged sources that came under legal hold. */
export const WARDROBE_HELD_FOLDER = 'held'

/**
 * Where the server keeps an immutable copy of a pending garment's staged source once the garment
 * is under legal hold: `held/<userId>/<garmentId>.<ext>`. Only the server writes it, once, and
 * only with bytes whose sha256 matched the garment's declaration, so a late or overlapping
 * transfer to the staging key can never change what the hold preserves. No signed URL ever
 * names it, and the bucket's read policy only admits keys under `wardrobe/`.
 */
export function buildWardrobeHeldObjectPath(
  userId: string,
  garmentId: string,
  extension: GarmentObjectExtension
): string {
  return `${WARDROBE_HELD_FOLDER}/${segment(userId, 'USER')}/${segment(garmentId, 'OBJECT')}.${extension}`
}

/** Inverse of {@link buildWardrobeHeldObjectPath}; null for any other path. */
export function parseWardrobeHeldObjectPath(objectPath: string): {
  userId: string
  garmentId: string
  extension: GarmentObjectExtension
} | null {
  const match =
    /^held\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\.(jpg|png|webp)$/.exec(
      objectPath
    )
  const userId = match?.[1]
  const garmentId = match?.[2]
  const extension = match?.[3] as GarmentObjectExtension | undefined
  if (!userId || !garmentId || !extension) {
    return null
  }
  return { userId, garmentId, extension }
}

/**
 * Inverse of the three final-path builders above. Returns null for any path they could not
 * have produced, so a path column naming another folder, another member or a staging key is
 * never mistaken for this member's object.
 */
export function parseWardrobeObjectPath(objectPath: string): {
  userId: string
  kind: WardrobeObjectKind
  objectId: string
  extension: GarmentObjectExtension
} | null {
  const match =
    /^wardrobe\/([A-Za-z0-9_-]{1,128})\/(?:(silhouette|palette)\/)?([A-Za-z0-9_-]{1,128})\.(jpg|png|webp)$/.exec(
      objectPath
    )
  const userId = match?.[1]
  const folder = match?.[2]
  const objectId = match?.[3]
  const extension = match?.[4] as GarmentObjectExtension | undefined
  if (!userId || !objectId || !extension) {
    return null
  }
  const kind: WardrobeObjectKind =
    folder === 'silhouette' ? 'silhouette' : folder === 'palette' ? 'palette' : 'garment'
  return { userId, kind, objectId, extension }
}

/** Story 6.1: community lookbook photos live in their own public-feed bucket,
 * and their path deliberately carries NO user id. The wardrobe paths above put
 * the owner's id in the first segment because that segment IS the storage RLS
 * key for a private, owner-only bucket. A community post is served to every
 * viewer through a signed URL, so the same convention would publish the
 * author's id to the whole feed and break the story's pseudonymity rule
 * ("Never: put user IDs in object paths or signed URLs").
 *
 * `uploadSessionId` is an unguessable per-allocation UUID, so the path is also
 * the durable record of which upload session owns the object: a replayed
 * allocate re-signs this exact path, and publish rejects a session id that does
 * not match it.
 */
export function buildCommunityObjectPath(
  postId: string,
  uploadSessionId: string,
  extension: GarmentObjectExtension
): string {
  return `community/${postId}/${uploadSessionId}.${extension}`
}

/** Inverse of {@link buildCommunityObjectPath}. Returns null for any path that
 * was not produced by it, so a legacy or hand-written path can never be
 * mistaken for a valid upload session. */
export function parseCommunityObjectPath(
  objectPath: string
): { postId: string; uploadSessionId: string; extension: string } | null {
  const match = /^community\/([^/]+)\/([^/.]+)\.([a-z]+)$/.exec(objectPath)
  const postId = match?.[1]
  const uploadSessionId = match?.[2]
  const extension = match?.[3]
  if (!postId || !uploadSessionId || !extension) {
    return null
  }
  return { postId, uploadSessionId, extension }
}
