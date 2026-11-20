// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { InternalServerErrorException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  isOwnGarmentObject,
  isOwnSessionObject,
  isOwnWardrobeObject,
  objectExtensionFor,
  ownSessionObjectsToRemove,
  uploadPathInvalid,
  uploadSessionKeys,
} from './wardrobe-upload-paths'

const SESSION = '5f0c1d1e-7a7a-4b4b-8c8c-9d9d9d9d9d9d'
const GARMENT = '0b6a3f62-9d1c-4a0e-8f4f-3c2b1a0d9e8f'

describe('objectExtensionFor', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ] as const)('names %s objects .%s', (mimeType, extension) => {
    expect(objectExtensionFor(mimeType)).toBe(extension)
  })
})

/**
 * Review round 1, 2026-11-19 (Codex 1): before the revoke migration a member could write their
 * own row's path columns, and the service role then read, moved or deleted whatever object they
 * named. Every service-role call that takes a path from a row checks it is the member's own.
 */
describe('isOwnWardrobeObject', () => {
  it.each([
    ['garment', 'wardrobe/user-1/garment-1.jpg'],
    ['silhouette', 'wardrobe/user-1/silhouette/session-1.png'],
    ['palette', 'wardrobe/user-1/palette/session-1.webp'],
  ] as const)('accepts the member own %s object', (kind, path) => {
    expect(isOwnWardrobeObject(path, 'user-1', kind)).toBe(true)
  })

  it.each([
    ['another member', 'wardrobe/user-2/silhouette/session-1.png'],
    ['another kind', 'wardrobe/user-1/palette/session-1.png'],
    ['a garment where a My Form photo belongs', 'wardrobe/user-1/session-1.png'],
    ['a staging key', 'staging/session-1.png'],
    ['a community object', 'community/post-1/session-1.png'],
    ['a traversal', 'wardrobe/user-1/silhouette/../../user-2/silhouette/s.png'],
    ['nothing', null],
    ['an empty path', ''],
  ])('refuses %s', (_, path) => {
    expect(isOwnWardrobeObject(path, 'user-1', 'silhouette')).toBe(false)
  })
})

describe('isOwnGarmentObject', () => {
  // Review round 2, 2026-11-19: capsule and planner sign a garment image only from its own object.
  it('accepts only the garment own folder, kind and id', () => {
    const garment = { id: 'garment-1', user_id: 'user-1' }
    expect(
      isOwnGarmentObject({ ...garment, object_path: 'wardrobe/user-1/garment-1.jpg' })
    ).toBe(true)
    for (const objectPath of [
      null,
      'wardrobe/user-2/garment-1.jpg',
      'wardrobe/user-1/garment-2.jpg',
      'wardrobe/user-1/silhouette/garment-1.jpg',
      'staging/garment-1.jpg',
    ]) {
      expect(
        isOwnGarmentObject({ ...garment, object_path: objectPath }),
        String(objectPath)
      ).toBe(false)
    }
  })
})

describe('uploadPathInvalid', () => {
  it('is a 500 the member cannot fix, carrying no path', () => {
    const error = uploadPathInvalid({
      operation: 'commit',
      kind: 'garment',
      rowId: 'g-1',
    })

    expect(error).toBeInstanceOf(InternalServerErrorException)
    expect(error.getStatus()).toBe(500)
    expect(error.message).toBe('UPLOAD_PATH_INVALID')
  })
})

/**
 * Review round 2, 2026-11-19 (Codex C2-2): the id columns are text and were member-writable
 * before the revoke migration. A session whose ids or stored path cannot be trusted yields no
 * keys, and callers answer it as an expired session before any storage call.
 */
describe('uploadSessionKeys', () => {
  it('derives the staging and final keys of a trusted garment session', () => {
    expect(
      uploadSessionKeys({
        kind: 'garment',
        userId: 'user-1',
        objectId: GARMENT,
        uploadSessionId: SESSION,
        mimeType: 'image/jpeg',
        storedObjectPath: `wardrobe/user-1/${GARMENT}.jpg`,
      })
    ).toEqual({
      stagingPath: `staging/user-1/garment/${SESSION}.jpg`,
      finalPath: `wardrobe/user-1/${GARMENT}.jpg`,
    })
  })

  it('derives My Form and selfie keys from the session id', () => {
    expect(
      uploadSessionKeys({
        kind: 'palette',
        userId: 'user-1',
        objectId: SESSION,
        uploadSessionId: SESSION,
        mimeType: 'image/webp',
        storedObjectPath: `wardrobe/user-1/palette/${SESSION}.webp`,
      })
    ).toEqual({
      stagingPath: `staging/user-1/palette/${SESSION}.webp`,
      finalPath: `wardrobe/user-1/palette/${SESSION}.webp`,
    })
  })

  it.each([
    ['a session id that is not a UUID', { uploadSessionId: 'session-1' }],
    ['a session id with path segments', { uploadSessionId: '../../user-2/x' }],
    ['a garment id that is not a UUID', { objectId: 'teen-1-garment-1' }],
    ['an owner id with a folder in it', { userId: 'user-1/../user-2' }],
    ['a MIME type the bucket does not take', { mimeType: 'image/gif' }],
    [
      'a stored path naming another member',
      { storedObjectPath: `wardrobe/user-2/${GARMENT}.jpg` },
    ],
    [
      'a stored path with another extension',
      { storedObjectPath: `wardrobe/user-1/${GARMENT}.png` },
    ],
    [
      'a malformed id whose stored path was built from it',
      { objectId: '../user-2/g', storedObjectPath: 'wardrobe/user-1/../user-2/g.jpg' },
    ],
  ])('yields no keys for %s', (_case, override) => {
    expect(
      uploadSessionKeys({
        kind: 'garment',
        userId: 'user-1',
        objectId: GARMENT,
        uploadSessionId: SESSION,
        mimeType: 'image/jpeg',
        storedObjectPath: `wardrobe/user-1/${GARMENT}.jpg`,
        ...override,
      })
    ).toBeNull()
  })
})

describe('isOwnSessionObject', () => {
  it('accepts the exact object id in any allowed extension and nothing else', () => {
    const path = `wardrobe/user-1/silhouette/${SESSION}.png`
    expect(isOwnSessionObject(path, 'user-1', 'silhouette', SESSION)).toBe(true)
    expect(
      isOwnSessionObject(
        `wardrobe/user-1/silhouette/${SESSION}.webp`,
        'user-1',
        'silhouette',
        SESSION
      )
    ).toBe(true)
    expect(isOwnSessionObject(path, 'user-1', 'silhouette', GARMENT)).toBe(false)
    expect(isOwnSessionObject(path, 'user-2', 'silhouette', SESSION)).toBe(false)
    expect(isOwnSessionObject(path, 'user-1', 'palette', SESSION)).toBe(false)
    expect(isOwnSessionObject(path, 'user-1', 'silhouette', null)).toBe(false)
  })
})

describe('ownSessionObjectsToRemove', () => {
  const base = {
    kind: 'silhouette' as const,
    rowId: 'profile-1',
    userId: 'user-1',
    uploadSessionId: SESSION,
    mimeType: 'image/jpeg',
    storedObjectPath: `wardrobe/user-1/silhouette/${SESSION}.jpg`,
  }

  it('names the final object and the staging key of a trusted session', () => {
    expect(ownSessionObjectsToRemove(base)).toEqual([
      `wardrobe/user-1/silhouette/${SESSION}.jpg`,
      `staging/user-1/silhouette/${SESSION}.jpg`,
    ])
  })

  it('still names the final object after an enqueue rollback cleared the session', () => {
    expect(ownSessionObjectsToRemove({ ...base, uploadSessionId: null })).toEqual([
      `wardrobe/user-1/silhouette/${SESSION}.jpg`,
    ])
  })

  it("never names another member's object or another session's", () => {
    expect(
      ownSessionObjectsToRemove({
        ...base,
        storedObjectPath: `wardrobe/user-2/silhouette/${SESSION}.jpg`,
      })
    ).toEqual([`staging/user-1/silhouette/${SESSION}.jpg`])
    expect(
      ownSessionObjectsToRemove({
        ...base,
        storedObjectPath: `wardrobe/user-1/silhouette/${GARMENT}.jpg`,
      })
    ).toEqual([`staging/user-1/silhouette/${SESSION}.jpg`])
  })

  it('names no staging key for a malformed session id', () => {
    expect(
      ownSessionObjectsToRemove({
        ...base,
        uploadSessionId: 'not-a-uuid',
        storedObjectPath: null,
      })
    ).toEqual([])
  })
})
