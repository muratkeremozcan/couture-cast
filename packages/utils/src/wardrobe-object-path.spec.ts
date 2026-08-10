import { describe, expect, it } from 'vitest'
import { buildGarmentObjectPath, buildSilhouetteObjectPath } from './wardrobe-object-path'

describe('buildGarmentObjectPath', () => {
  it('constructs correct object path for given user, garment, and extension', () => {
    const path = buildGarmentObjectPath('user_123', 'garment_456', 'png')
    expect(path).toBe('wardrobe/user_123/garment_456.png')
  })

  it('handles jpg and webp extensions correctly', () => {
    expect(buildGarmentObjectPath('user_1', 'g_1', 'jpg')).toBe('wardrobe/user_1/g_1.jpg')
    expect(buildGarmentObjectPath('user_2', 'g_2', 'webp')).toBe(
      'wardrobe/user_2/g_2.webp'
    )
  })
})

describe('buildSilhouetteObjectPath', () => {
  it('nests My Form photos under the user folder, in a silhouette/ prefix', () => {
    const path = buildSilhouetteObjectPath('user_123', 'session_456', 'jpg')
    expect(path).toBe('wardrobe/user_123/silhouette/session_456.jpg')
  })

  it('shares the same wardrobe/<userId>/ prefix as garment paths, so the existing storage RLS policy already authorizes it', () => {
    const garmentPath = buildGarmentObjectPath('user_9', 'garment_9', 'png')
    const silhouettePath = buildSilhouetteObjectPath('user_9', 'session_9', 'png')
    expect(silhouettePath.startsWith('wardrobe/user_9/')).toBe(true)
    expect(garmentPath.startsWith('wardrobe/user_9/')).toBe(true)
  })
})
