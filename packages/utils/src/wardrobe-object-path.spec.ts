// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { describe, expect, it } from 'vitest'
import {
  buildCommunityObjectPath,
  buildGarmentObjectPath,
  buildPaletteSelfieObjectPath,
  buildSilhouetteObjectPath,
  buildWardrobeObjectPath,
  buildWardrobeHeldObjectPath,
  buildWardrobeStagingObjectPath,
  isWardrobePathSegment,
  isWardrobeUuid,
  parseCommunityObjectPath,
  parseWardrobeObjectPath,
  parseWardrobeHeldObjectPath,
  parseWardrobeStagingObjectPath,
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

describe('buildWardrobeStagingObjectPath', () => {
  const SESSION = '5f0c1d1e-7a7a-4b4b-8c8c-9d9d9d9d9d9d'

  /**
   * Production follow-up 2026-11-19 (round 3): a signed upload URL outlives its row, so it only
   * ever names a staging key, which carries the owner, the kind and the session. The bucket's
   * read policy admits only keys under wardrobe/, so the staging key is service-only.
   */
  it('puts the upload under staging/<user>/<kind>/<session>', () => {
    expect(buildWardrobeStagingObjectPath('user-1', 'garment', SESSION, 'jpg')).toBe(
      `staging/user-1/garment/${SESSION}.jpg`
    )
    expect(buildWardrobeStagingObjectPath('user-1', 'silhouette', SESSION, 'png')).toBe(
      `staging/user-1/silhouette/${SESSION}.png`
    )
    expect(buildWardrobeStagingObjectPath('user-1', 'palette', SESSION, 'webp')).toBe(
      `staging/user-1/palette/${SESSION}.webp`
    )
  })

  it('round-trips through parseWardrobeStagingObjectPath', () => {
    expect(
      parseWardrobeStagingObjectPath(
        buildWardrobeStagingObjectPath('user-1', 'palette', SESSION, 'webp')
      )
    ).toEqual({
      userId: 'user-1',
      kind: 'palette',
      uploadSessionId: SESSION,
      extension: 'webp',
    })
  })

  /** Codex round 2 finding 2: a malformed historical id must never reach a storage key. */
  it('refuses a session id that is not a UUID and a user id that is not one key segment', () => {
    expect(() =>
      buildWardrobeStagingObjectPath('user-1', 'garment', '../wardrobe/user-2/x', 'jpg')
    ).toThrow('WARDROBE_KEY_SESSION_INVALID')
    expect(() =>
      buildWardrobeStagingObjectPath('user-1', 'garment', 'session-1', 'jpg')
    ).toThrow('WARDROBE_KEY_SESSION_INVALID')
    expect(() =>
      buildWardrobeStagingObjectPath('user-1/../user-2', 'garment', SESSION, 'jpg')
    ).toThrow('WARDROBE_KEY_USER_INVALID')
  })

  it('parses nothing that is not a staging key', () => {
    for (const path of [
      'wardrobe/user-1/garment-1.jpg',
      `staging/${SESSION}.jpg`,
      `staging/user-1/other/${SESSION}.jpg`,
      'staging/user-1/garment/session-1.jpg',
      `staging/user-1/garment/${SESSION}.gif`,
      `staging/user-1/../garment/${SESSION}.jpg`,
      `staging/user-1/garment/a/${SESSION}.jpg`,
    ]) {
      expect(parseWardrobeStagingObjectPath(path), path).toBeNull()
    }
  })
})

describe('buildWardrobeHeldObjectPath', () => {
  /**
   * Codex round 4 finding 6: a held pending garment's verified source is copied to a key only
   * the server writes, so an overlapping transfer to staging cannot change what the hold keeps.
   */
  it('puts the held copy under held/<user>/<garment> and parses it back', () => {
    const path = buildWardrobeHeldObjectPath('user-1', 'garment-1', 'webp')
    expect(path).toBe('held/user-1/garment-1.webp')
    expect(parseWardrobeHeldObjectPath(path)).toEqual({
      userId: 'user-1',
      garmentId: 'garment-1',
      extension: 'webp',
    })
  })

  it('refuses ids that would add or climb a folder, and parses nothing else', () => {
    expect(() => buildWardrobeHeldObjectPath('user-1/../x', 'g', 'jpg')).toThrow(
      'WARDROBE_KEY_USER_INVALID'
    )
    expect(() => buildWardrobeHeldObjectPath('user-1', '../g', 'jpg')).toThrow(
      'WARDROBE_KEY_OBJECT_INVALID'
    )
    for (const path of [
      'wardrobe/user-1/garment-1.jpg',
      'held/user-1/garment-1.gif',
      'held/user-1/x/garment-1.jpg',
      'held/garment-1.jpg',
    ]) {
      expect(parseWardrobeHeldObjectPath(path), path).toBeNull()
    }
  })
})

describe('id guards', () => {
  it('accepts only UUID-shaped ids as wardrobe UUIDs', () => {
    expect(isWardrobeUuid('5f0c1d1e-7a7a-4b4b-8c8c-9d9d9d9d9d9d')).toBe(true)
    expect(isWardrobeUuid('teen-1-garment-1')).toBe(false)
    expect(isWardrobeUuid(null)).toBe(false)
  })

  it('accepts only single safe key segments', () => {
    expect(isWardrobePathSegment('premium-active-user')).toBe(true)
    expect(isWardrobePathSegment('a/b')).toBe(false)
    expect(isWardrobePathSegment('..')).toBe(false)
    expect(isWardrobePathSegment('')).toBe(false)
  })

  it('makes every final-path builder refuse an id that would add or climb a folder', () => {
    expect(() => buildGarmentObjectPath('user-1', '../user-2/g', 'jpg')).toThrow(
      'WARDROBE_KEY_OBJECT_INVALID'
    )
    expect(() => buildSilhouetteObjectPath('user/1', 'session-1', 'jpg')).toThrow(
      'WARDROBE_KEY_USER_INVALID'
    )
    expect(buildWardrobeObjectPath('user-1', 'palette', 'session-1', 'png')).toBe(
      'wardrobe/user-1/palette/session-1.png'
    )
  })
})

describe('parseWardrobeObjectPath', () => {
  it('reads owner, kind and object id back from each final-path builder', () => {
    expect(
      parseWardrobeObjectPath(buildGarmentObjectPath('user-1', 'garment-1', 'jpg'))
    ).toEqual({
      userId: 'user-1',
      kind: 'garment',
      objectId: 'garment-1',
      extension: 'jpg',
    })
    expect(
      parseWardrobeObjectPath(buildSilhouetteObjectPath('user-1', 'session-1', 'png'))
    ).toEqual({
      userId: 'user-1',
      kind: 'silhouette',
      objectId: 'session-1',
      extension: 'png',
    })
    expect(
      parseWardrobeObjectPath(buildPaletteSelfieObjectPath('user-1', 'session-2', 'webp'))
    ).toEqual({
      userId: 'user-1',
      kind: 'palette',
      objectId: 'session-2',
      extension: 'webp',
    })
  })

  /** A path column naming anything else must never pass for a member's own object. */
  it('parses nothing a final-path builder could not have produced', () => {
    for (const path of [
      'staging/session-1.jpg',
      'staging/user-1/garment/5f0c1d1e-7a7a-4b4b-8c8c-9d9d9d9d9d9d.jpg',
      'community/post-1/session-1.jpg',
      'wardrobe/user-1/other/session-1.jpg',
      'wardrobe/user-1/garment-1.gif',
      'wardrobe/user-1/../user-2/garment-1.jpg',
      'wardrobe/user-1/silhouette/a/b.jpg',
      'wardrobe//garment-1.jpg',
    ]) {
      expect(parseWardrobeObjectPath(path), path).toBeNull()
    }
  })
})
