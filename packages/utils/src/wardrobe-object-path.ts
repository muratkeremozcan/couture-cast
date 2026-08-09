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
