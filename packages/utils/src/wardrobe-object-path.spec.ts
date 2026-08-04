import { describe, expect, it } from 'vitest'
import { buildGarmentObjectPath } from './wardrobe-object-path'

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
