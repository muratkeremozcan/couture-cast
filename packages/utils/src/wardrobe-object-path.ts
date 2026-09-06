export type GarmentObjectExtension = 'jpg' | 'png' | 'webp'

export function buildGarmentObjectPath(
  userId: string,
  garmentId: string,
  extension: GarmentObjectExtension
): string {
  return `wardrobe/${userId}/${garmentId}.${extension}`
}

/** Story 4.4: "My Form" photos live in the same bucket/user folder as
 * garments, under a silhouette/ prefix, so the existing storage RLS policy
 * (keyed on the folder's user_id path segment) already authorizes them. */
export function buildSilhouetteObjectPath(
  userId: string,
  uploadSessionId: string,
  extension: GarmentObjectExtension
): string {
  return `wardrobe/${userId}/silhouette/${uploadSessionId}.${extension}`
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
  return `wardrobe/${userId}/palette/${uploadSessionId}.${extension}`
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
