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
