export type GarmentObjectExtension = 'jpg' | 'png' | 'webp'

export function buildGarmentObjectPath(
  userId: string,
  garmentId: string,
  extension: GarmentObjectExtension
): string {
  return `wardrobe/${userId}/${garmentId}.${extension}`
}
