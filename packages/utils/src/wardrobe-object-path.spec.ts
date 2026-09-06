// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
import { describe, expect, it } from 'vitest'
import {
  buildCommunityObjectPath,
  buildGarmentObjectPath,
  buildPaletteSelfieObjectPath,
  buildSilhouetteObjectPath,
  parseCommunityObjectPath,
} from './wardrobe-object-path'

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

describe('buildPaletteSelfieObjectPath', () => {
  it('nests palette selfies under the user folder, in a palette/ prefix', () => {
    const path = buildPaletteSelfieObjectPath('user_123', 'session_456', 'jpg')
    expect(path).toBe('wardrobe/user_123/palette/session_456.jpg')
  })

  it('shares the same wardrobe/<userId>/ prefix so the existing storage RLS policy already authorizes it', () => {
    const path = buildPaletteSelfieObjectPath('user_9', 'session_9', 'webp')
    expect(path.startsWith('wardrobe/user_9/')).toBe(true)
  })
})

// Story 6.1: the community pair is load-bearing for the story's rule "Never:
// put user IDs in object paths or signed URLs". A community object is served to
// every viewer of the feed through a signed URL, so the path is public in a way
// no wardrobe path is, and it gets direct tests rather than incidental coverage
// through the service.
describe('buildCommunityObjectPath', () => {
  it('nests community photos under the post, with no user segment anywhere', () => {
    const path = buildCommunityObjectPath('post_123', 'session_456', 'jpg')
    expect(path).toBe('community/post_123/session_456.jpg')
  })

  it('never places the author id in the path, even when it is available to the caller', () => {
    const authorId = 'user_123'
    const path = buildCommunityObjectPath('post_123', 'session_456', 'png')
    expect(path).not.toContain(authorId)
    expect(path.startsWith('community/')).toBe(true)
    // The wardrobe convention is the thing being deliberately broken here: it
    // puts the owner id in the first segment because that segment is the
    // storage RLS key for a private bucket.
    expect(buildGarmentObjectPath(authorId, 'garment_1', 'png')).toContain(authorId)
  })

  it('carries the extension through for every allowed image type', () => {
    expect(buildCommunityObjectPath('p', 's', 'jpg')).toBe('community/p/s.jpg')
    expect(buildCommunityObjectPath('p', 's', 'png')).toBe('community/p/s.png')
    expect(buildCommunityObjectPath('p', 's', 'webp')).toBe('community/p/s.webp')
  })
})

describe('parseCommunityObjectPath', () => {
  it('round trips every extension the builder can produce', () => {
    for (const extension of ['jpg', 'png', 'webp'] as const) {
      const path = buildCommunityObjectPath('post_123', 'session_456', extension)
      expect(parseCommunityObjectPath(path)).toEqual({
        postId: 'post_123',
        uploadSessionId: 'session_456',
        extension,
      })
    }
  })

  it('rejects a path with too few segments', () => {
    expect(parseCommunityObjectPath('community/session_456.jpg')).toBeNull()
  })

  it('rejects a path with too many segments', () => {
    expect(
      parseCommunityObjectPath('community/post_123/nested/session_456.jpg')
    ).toBeNull()
  })

  it('rejects a prefix that is not community/, including a wardrobe path', () => {
    expect(parseCommunityObjectPath('wardrobe/user_123/session_456.jpg')).toBeNull()
    expect(
      parseCommunityObjectPath(buildGarmentObjectPath('user_1', 'g_1', 'jpg'))
    ).toBeNull()
    expect(parseCommunityObjectPath('communityx/post_123/session_456.jpg')).toBeNull()
    expect(parseCommunityObjectPath('/community/post_123/session_456.jpg')).toBeNull()
  })

  it('rejects a missing or non-lowercase-alphabetic extension', () => {
    expect(parseCommunityObjectPath('community/post_123/session_456')).toBeNull()
    expect(parseCommunityObjectPath('community/post_123/session_456.')).toBeNull()
    expect(parseCommunityObjectPath('community/post_123/session_456.JPG')).toBeNull()
    expect(parseCommunityObjectPath('community/post_123/session_456.mp4v2')).toBeNull()
  })

  it('rejects empty segments rather than returning blank identifiers', () => {
    expect(parseCommunityObjectPath('community//session_456.jpg')).toBeNull()
    expect(parseCommunityObjectPath('community/post_123/.jpg')).toBeNull()
    expect(parseCommunityObjectPath('')).toBeNull()
  })

  it('returns null for malformed input, which a caller can distinguish from a parse', () => {
    // The failure value is null rather than a record with empty fields, so
    // `if (!parsed)` is the whole check and no caller can read an empty postId
    // off a rejected path.
    const parsed = parseCommunityObjectPath('not a path at all')
    expect(parsed).toBeNull()
    const valid = parseCommunityObjectPath('community/post_123/session_456.webp')
    expect(valid).not.toBeNull()
    expect(valid?.postId).toBe('post_123')
  })
})
