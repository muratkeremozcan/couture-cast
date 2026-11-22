// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import { DEFAULT_SAMPLE_COMFORT, stylePieceStorageKey } from '@couture/utils'

const {
  apiV1WardrobeSavedLooksGet,
  apiV1WardrobeSavedLooksPost,
  apiV1WardrobeSavedLooksSavedLookIdGet,
  apiV1WardrobeSavedLooksSavedLookIdDelete,
  apiV1WardrobeSavedLooksSavedLookIdRestorePost,
  currentWebSessionBearer,
  currentWebSessionOwner,
  listGarmentsFromWeb,
  readStorage,
} = vi.hoisted(() => ({
  apiV1WardrobeSavedLooksGet: vi.fn(),
  apiV1WardrobeSavedLooksPost: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdGet: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdDelete: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdRestorePost: vi.fn(),
  currentWebSessionBearer: vi.fn<() => string | null>(() => 'verified-token'),
  currentWebSessionOwner: vi.fn<() => string | null>(() => 'user-1'),
  listGarmentsFromWeb: vi.fn<() => Promise<GarmentItemContract[]>>(() =>
    Promise.resolve([])
  ),
  readStorage: vi.fn<() => string | null>(() => null),
}))

vi.mock('./api-client', () => ({
  createWebApiClient: () => ({
    apiV1WardrobeSavedLooksGet,
    apiV1WardrobeSavedLooksPost,
    apiV1WardrobeSavedLooksSavedLookIdGet,
    apiV1WardrobeSavedLooksSavedLookIdDelete,
    apiV1WardrobeSavedLooksSavedLookIdRestorePost,
  }),
}))

vi.mock('./use-web-session', () => ({
  UNVERIFIED_BEARER_OWNER: 'bearer',
  currentWebSessionBearer,
  currentWebSessionOwner,
  isLiveOwner: (owner: string | null) =>
    owner !== null && currentWebSessionOwner() === owner,
}))

vi.mock('./wardrobe', () => ({
  listGarmentsFromWeb,
}))

vi.mock('./browser-persistence', () => ({
  WEB_ACCESS_TOKEN_STORAGE_KEY: 'couturecast.accessToken',
  readStorage,
}))

import {
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  getSavedLookFromWeb,
  importLegacyDeviceSavedLooksFromWeb,
  listSavedLooksFromWeb,
  listSavedLooksPageFromWeb,
  notifySavedLooksChanged,
  resetWebLegacySavedLooksImportState,
  restoreSavedLookFromWeb,
  SavedLookRequestError,
  subscribeSavedLooksChanged,
} from './saved-looks'

const SAMPLE_LOOK: SavedLookContract = {
  id: 'sl-1',
  ownerUserId: 'user-1',
  source: 'home_sample',
  lookId: 'look-01',
  weather: 'mild-dry',
  title: null,
  anchorGarmentId: null,
  anchorSnapshot: null,
  composition: [
    {
      slotIndex: 0,
      category: 'top',
      kind: 'catalog',
      itemId: 'sample:g:top-1',
      label: null,
      missing: false,
      imageAccess: null,
    },
  ],
  swaps: {},
  collection: 'all',
  comfort: {
    runsColdWarm: 'neutral',
    windTolerance: 'medium',
    precipPreparedness: 'medium',
  },
  availabilityStatus: 'ready',
  missingGarmentIds: [],
  needsReviewReasons: [],
  revision: 0,
  createdAt: '2026-11-22T01:00:00.000Z',
  updatedAt: '2026-11-22T01:00:00.000Z',
}

describe('web saved-looks client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    resetWebLegacySavedLooksImportState()
    currentWebSessionBearer.mockReturnValue('verified-token')
    currentWebSessionOwner.mockReturnValue('user-1')
    listGarmentsFromWeb.mockResolvedValue([])
    readStorage.mockReturnValue(null)
  })

  it('lists, creates with Idempotency-Key, gets, and deletes with If-Match', async () => {
    expect(formatSavedLookIfMatch('sl-1', 2)).toBe('"saved-look:sl-1:2"')

    apiV1WardrobeSavedLooksGet.mockResolvedValueOnce({
      data: [SAMPLE_LOOK],
      total: 1,
      limit: 50,
      offset: 0,
    })
    const list = await listSavedLooksFromWeb({ source: 'home_sample' })
    expect(list).toEqual([SAMPLE_LOOK])

    apiV1WardrobeSavedLooksPost.mockResolvedValueOnce({ data: SAMPLE_LOOK })
    const created = await createSavedLookFromWeb(
      {
        source: 'home_sample',
        lookId: 'look-01',
        weather: 'mild-dry',
        composition: [
          { slotIndex: 0, category: 'top', kind: 'catalog', itemId: 'sample:g:top-1' },
        ],
        swaps: {},
        collection: 'all',
        comfort: SAMPLE_LOOK.comfort,
      },
      { idempotencyKey: '11111111-1111-4111-8111-111111111111' }
    )
    expect(created.id).toBe('sl-1')
    expect(apiV1WardrobeSavedLooksPost).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      }),
      expect.anything()
    )

    apiV1WardrobeSavedLooksSavedLookIdGet.mockResolvedValueOnce({ data: SAMPLE_LOOK })
    const controller = new AbortController()
    const single = await getSavedLookFromWeb('sl-1', controller.signal)
    expect(single.id).toBe('sl-1')

    apiV1WardrobeSavedLooksSavedLookIdDelete.mockResolvedValueOnce(undefined)
    await deleteSavedLookFromWeb('sl-1', formatSavedLookIfMatch('sl-1', 0), {
      accessToken: 'pinned-token',
      signal: controller.signal,
    })
    apiV1WardrobeSavedLooksSavedLookIdDelete.mockResolvedValueOnce(undefined)
    await deleteSavedLookFromWeb(
      'sl-1',
      formatSavedLookIfMatch('sl-1', 0),
      controller.signal
    )
    expect(apiV1WardrobeSavedLooksSavedLookIdDelete).toHaveBeenCalledWith(
      { savedLookId: 'sl-1', ifMatch: '"saved-look:sl-1:0"' },
      expect.anything()
    )

    apiV1WardrobeSavedLooksGet.mockResolvedValueOnce({
      data: [SAMPLE_LOOK],
      total: 52,
      limit: 50,
      offset: 0,
    })
    const page = await listSavedLooksPageFromWeb({
      limit: 50,
      offset: 0,
      signal: controller.signal,
    })
    expect(page.total).toBe(52)

    apiV1WardrobeSavedLooksSavedLookIdRestorePost.mockResolvedValueOnce({
      data: { ...SAMPLE_LOOK, revision: 1 },
    })
    const restored = await restoreSavedLookFromWeb('sl-1', {
      accessToken: 'pinned-token',
      signal: controller.signal,
    })
    expect(restored.revision).toBe(1)

    const seen: (string | null)[] = []
    const unsub = subscribeSavedLooksChanged((owner) => seen.push(owner))
    notifySavedLooksChanged('user-1')
    unsub()
    notifySavedLooksChanged('user-1')
    expect(seen).toEqual(['user-1'])
  })

  it('falls back to stored session token and normalizes API & signed-out errors', async () => {
    currentWebSessionBearer.mockReturnValue(null)
    readStorage.mockReturnValue('stored-token')
    apiV1WardrobeSavedLooksGet.mockRejectedValueOnce(
      new ResponseError(
        new Response(JSON.stringify({ message: 'SAVED_LOOK_NOT_FOUND' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    await expect(listSavedLooksFromWeb()).rejects.toMatchObject({
      name: 'SavedLookRequestError',
      status: 404,
      message: 'SAVED_LOOK_NOT_FOUND',
    })

    readStorage.mockReturnValue(null)
    await expect(listSavedLooksFromWeb()).rejects.toBeInstanceOf(SavedLookRequestError)

    currentWebSessionBearer.mockReturnValue('verified-token')
    apiV1WardrobeSavedLooksSavedLookIdDelete.mockRejectedValueOnce(
      new ResponseError(new Response('bad gateway', { status: 502 }))
    )
    await expect(deleteSavedLookFromWeb('sl-1', '*')).rejects.toMatchObject({
      status: 502,
    })

    apiV1WardrobeSavedLooksSavedLookIdRestorePost.mockRejectedValueOnce('raw-failure')
    await expect(restoreSavedLookFromWeb('sl-1')).rejects.toThrow(
      'Unable to restore this saved look.'
    )

    apiV1WardrobeSavedLooksSavedLookIdGet.mockRejectedValueOnce(new Error('get-failure'))
    await expect(getSavedLookFromWeb('sl-1')).rejects.toThrow('get-failure')
  })

  it('handles notify callbacks, source filters, custom loadGarments, and blocked localStorage safely', async () => {
    const seenOwners: (string | null)[] = []
    const unsub = subscribeSavedLooksChanged((owner) => seenOwners.push(owner))

    const bookmarkKey = 'couturecast.member-sample-bookmarks.user-1'
    const styleKey = stylePieceStorageKey('user-1', 'garment-1')
    window.localStorage.setItem(
      bookmarkKey,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          collection: 'all',
          comfort: DEFAULT_SAMPLE_COMFORT,
          swaps: {},
        },
      ])
    )
    window.localStorage.setItem(
      styleKey,
      JSON.stringify([
        { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
      ])
    )

    apiV1WardrobeSavedLooksPost.mockResolvedValue({ data: SAMPLE_LOOK })

    // Restrict import to home_sample only with notify: true
    const homeOnly = await importLegacyDeviceSavedLooksFromWeb({
      owner: 'user-1',
      sources: ['home_sample'],
      notify: true,
    })
    expect(homeOnly.imported).toHaveLength(1)
    expect(seenOwners).toEqual(['user-1'])
    expect(window.localStorage.getItem(bookmarkKey)).toBeNull()
    expect(window.localStorage.getItem(styleKey)).not.toBeNull()

    // Restrict import to style_piece only with custom loadGarments
    const customLoad = vi.fn().mockResolvedValue([
      {
        id: 'garment-1',
        status: 'ready',
        retentionStatus: 'active',
        category: 'top',
        comfortRange: 'mild',
        material: 'cotton',
        tagsConfirmedAt: '2026-11-22T00:00:00.000Z',
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        createdAt: '2026-11-22T00:00:00.000Z',
        committedAt: '2026-11-22T00:00:00.000Z',
        imageAccess: null,
      },
    ])
    const styleOnly = await importLegacyDeviceSavedLooksFromWeb({
      owner: 'user-1',
      sources: ['style_piece'],
      loadGarments: customLoad,
      notify: true,
    })
    expect(customLoad).toHaveBeenCalledTimes(1)
    expect(styleOnly.imported).toHaveLength(1)
    expect(seenOwners).toEqual(['user-1', 'user-1'])
    expect(window.localStorage.getItem(styleKey)).toBeNull()

    unsub()

    // Blocked localStorage (SecurityError on getItem/setItem/removeItem/key) degrades cleanly
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const keySpy = vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const blockedResult = await importLegacyDeviceSavedLooksFromWeb({
      owner: 'user-1',
    })
    expect(blockedResult).toEqual({ imported: [], pendingKeys: 0 })
    getItemSpy.mockRestore()
    keySpy.mockRestore()

    // Blocked removeItem/setItem during cleanup does not throw
    window.localStorage.setItem(bookmarkKey, '{bad-json')
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const blockedRemove = await importLegacyDeviceSavedLooksFromWeb({
      owner: 'user-1',
    })
    expect(blockedRemove.pendingKeys).toBe(0)
    removeSpy.mockRestore()
    window.localStorage.clear()
  })

  it('imports same-member device-saved looks once per source id, preserves unresolved looks into needs_review, and leaves guest or other members untouched', async () => {
    const guestRaw = JSON.stringify({ schemaVersion: 1, weather: 'mild-dry' })
    const memberBRaw = JSON.stringify([
      {
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        swaps: {},
      },
    ])
    const memberBStyleKey = stylePieceStorageKey('user-2', 'garment-b')
    window.localStorage.setItem('couturecast.guest-preview.v1', guestRaw)
    window.localStorage.setItem('couturecast.member-sample-bookmarks.user-2', memberBRaw)
    window.localStorage.setItem(
      memberBStyleKey,
      '[{"lookId":"sample:l:office-oxford","weather":"mild-dry","swaps":{}}]'
    )

    // Member A (user-1) has 1 valid bookmark, 1 unresolved bookmark, 1 valid style_piece, 1 unresolved style_piece, and 1 tampered style_piece
    const user1BookmarksKey = 'couturecast.member-sample-bookmarks.user-1'
    window.localStorage.setItem(
      user1BookmarksKey,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          collection: 'all',
          comfort: DEFAULT_SAMPLE_COMFORT,
          swaps: { shoes: 'sample:g:white-sneakers' },
        },
        {
          lookId: 'sample:l:summer-linen',
          weather: 'cool-windy',
          collection: 'all',
          comfort: DEFAULT_SAMPLE_COMFORT,
          swaps: {},
        },
      ])
    )
    const user1ValidStyleKey = stylePieceStorageKey('user-1', 'garment-1')
    const user1ChangedStyleKey = stylePieceStorageKey('user-1', 'garment-changed')
    const user1TamperedStyleKey = stylePieceStorageKey(
      'user-1',
      'garment-belonging-to-user-2'
    )
    window.localStorage.setItem(
      user1ValidStyleKey,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: { shoes: 'sample:g:white-sneakers' },
        },
      ])
    )
    window.localStorage.setItem(
      user1ChangedStyleKey,
      JSON.stringify([
        {
          lookId: 'sample:l:silk-midi',
          weather: 'warm-rainy',
          swaps: { shoes: 'sample:g:loafers' },
        },
      ])
    )
    window.localStorage.setItem(
      user1TamperedStyleKey,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: {},
        },
      ])
    )

    listGarmentsFromWeb.mockResolvedValue([
      {
        id: 'garment-1',
        status: 'ready',
        retentionStatus: 'active',
        category: 'top',
        comfortRange: 'mild',
        material: 'cotton',
        tagsConfirmedAt: '2026-11-22T00:00:00.000Z',
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        createdAt: '2026-11-22T00:00:00.000Z',
        committedAt: '2026-11-22T00:00:00.000Z',
        imageAccess: null,
      },
      {
        id: 'garment-changed',
        status: 'ready',
        retentionStatus: 'active',
        category: 'outerwear',
        comfortRange: 'cold',
        material: 'wool',
        tagsConfirmedAt: '2026-11-22T00:00:00.000Z',
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        createdAt: '2026-11-22T00:00:00.000Z',
        committedAt: '2026-11-22T00:00:00.000Z',
        imageAccess: null,
      },
    ])

    const createdRecords: SavedLookContract[] = []
    apiV1WardrobeSavedLooksPost.mockImplementation(
      ({
        idempotencyKey,
        createSavedLookInput,
      }: {
        idempotencyKey?: string
        createSavedLookInput: {
          source: 'style_piece' | 'home_sample'
          lookId: string
          weather: string
          anchorGarmentId?: string | null
          anchorSnapshot?: SavedLookContract['anchorSnapshot']
          composition: SavedLookContract['composition']
          swaps?: SavedLookContract['swaps']
        }
      }) => {
        if (createSavedLookInput.anchorGarmentId === 'garment-belonging-to-user-2') {
          return Promise.reject(
            new ResponseError(
              new Response(JSON.stringify({ message: 'GARMENT_NOT_FOUND' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
              })
            )
          )
        }
        const isNeedsReview =
          createSavedLookInput.lookId === 'sample:l:summer-linen' ||
          createSavedLookInput.anchorGarmentId === 'garment-changed'
        const record: SavedLookContract = {
          ...SAMPLE_LOOK,
          id: `imported-${createdRecords.length + 1}-${idempotencyKey?.slice(0, 8)}`,
          source: createSavedLookInput.source,
          lookId: createSavedLookInput.lookId,
          weather: createSavedLookInput.weather,
          anchorGarmentId: createSavedLookInput.anchorGarmentId ?? null,
          anchorSnapshot: createSavedLookInput.anchorSnapshot ?? null,
          availabilityStatus: isNeedsReview ? 'needs_review' : 'ready',
          needsReviewReasons:
            createSavedLookInput.anchorGarmentId === 'garment-changed'
              ? ['category_changed', 'comfort_range_changed']
              : [],
        }
        createdRecords.push(record)
        return Promise.resolve({ data: record })
      }
    )

    apiV1WardrobeSavedLooksGet.mockImplementation(() =>
      Promise.resolve({
        data: createdRecords,
        total: createdRecords.length,
        limit: 50,
        offset: 0,
      })
    )

    const result = await listSavedLooksFromWeb({ owner: 'user-1' })
    expect(result).toHaveLength(4)
    expect(
      result.find((item) => item.lookId === 'sample:l:summer-linen')?.availabilityStatus
    ).toBe('needs_review')
    expect(
      result.find((item) => item.anchorGarmentId === 'garment-changed')
        ?.availabilityStatus
    ).toBe('needs_review')
    expect(
      result.find((item) => item.anchorGarmentId === 'garment-belonging-to-user-2')
    ).toBeUndefined()

    // User 1's device keys are removed after server acknowledgement / terminal 404 rejection
    expect(window.localStorage.getItem(user1BookmarksKey)).toBeNull()
    expect(window.localStorage.getItem(user1ValidStyleKey)).toBeNull()
    expect(window.localStorage.getItem(user1ChangedStyleKey)).toBeNull()
    expect(window.localStorage.getItem(user1TamperedStyleKey)).toBeNull()

    // Guest preview and user-2 keys are completely untouched
    expect(window.localStorage.getItem('couturecast.guest-preview.v1')).toBe(guestRaw)
    expect(
      window.localStorage.getItem('couturecast.member-sample-bookmarks.user-2')
    ).toBe(memberBRaw)
    expect(window.localStorage.getItem(memberBStyleKey)).not.toBeNull()
  })

  it('keeps unacknowledged entries retryable on transient errors, deduplicates concurrent retries, and fences on account switch', async () => {
    const key = 'couturecast.member-sample-bookmarks.user-1'
    const rawBookmarks = JSON.stringify([
      {
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        swaps: {},
      },
      {
        lookId: 'sample:l:city-wool',
        weather: 'cool-windy',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        swaps: {},
      },
    ])
    window.localStorage.setItem(key, rawBookmarks)

    // 1. First attempt: oldest entry (city-wool) succeeds, newest entry (office-oxford) fails with 503
    const seenIdempotencyKeys: string[] = []
    apiV1WardrobeSavedLooksPost
      .mockImplementationOnce(({ idempotencyKey }: { idempotencyKey: string }) => {
        seenIdempotencyKeys.push(idempotencyKey)
        return Promise.resolve({
          data: { ...SAMPLE_LOOK, id: 'sl-city-wool', lookId: 'sample:l:city-wool' },
        })
      })
      .mockImplementationOnce(({ idempotencyKey }: { idempotencyKey: string }) => {
        seenIdempotencyKeys.push(idempotencyKey)
        return Promise.reject(
          new ResponseError(new Response('service unavailable', { status: 503 }))
        )
      })

    const firstAttempt = await importLegacyDeviceSavedLooksFromWeb({ owner: 'user-1' })
    expect(firstAttempt.imported).toHaveLength(1)
    expect(firstAttempt.pendingKeys).toBe(1)
    // Only the unacknowledged entry remains in localStorage
    const remainingAfterFailure = JSON.parse(
      window.localStorage.getItem(key) ?? '[]'
    ) as { lookId: string }[]
    expect(remainingAfterFailure.map((b) => b.lookId)).toEqual(['sample:l:office-oxford'])

    // 2. Concurrent retries of the remaining entry reuse the exact same deterministic Idempotency-Key
    const idempotencyMap = new Map<string, SavedLookContract>()
    apiV1WardrobeSavedLooksPost.mockImplementation(
      ({ idempotencyKey }: { idempotencyKey: string }) => {
        seenIdempotencyKeys.push(idempotencyKey)
        const existing = idempotencyMap.get(idempotencyKey)
        if (existing) return Promise.resolve({ data: existing })
        const created = {
          ...SAMPLE_LOOK,
          id: 'sl-office-oxford',
          lookId: 'sample:l:office-oxford',
        }
        idempotencyMap.set(idempotencyKey, created)
        return Promise.resolve({ data: created })
      }
    )

    const [retryA, retryB] = await Promise.all([
      importLegacyDeviceSavedLooksFromWeb({ owner: 'user-1' }),
      importLegacyDeviceSavedLooksFromWeb({ owner: 'user-1' }),
    ])
    expect(idempotencyMap.size).toBe(1)
    expect(seenIdempotencyKeys[1]).toBe(seenIdempotencyKeys[2])
    expect(seenIdempotencyKeys[2]).toBe(seenIdempotencyKeys[3])
    expect(retryA.pendingKeys).toBe(0)
    expect(retryB.pendingKeys).toBe(0)
    expect(window.localStorage.getItem(key)).toBeNull()

    // 3. Account switch mid-import fences user-1 and keeps unacknowledged entries for user-1
    resetWebLegacySavedLooksImportState()
    window.localStorage.setItem(key, rawBookmarks)
    apiV1WardrobeSavedLooksPost.mockImplementationOnce(() => {
      // Switch active session to user-2 while user-1's first POST is in flight
      currentWebSessionOwner.mockReturnValue('user-2')
      return Promise.resolve({ data: { ...SAMPLE_LOOK, id: 'sl-city-wool' } })
    })

    const switched = await importLegacyDeviceSavedLooksFromWeb({
      owner: 'user-1',
      notify: true,
    })
    expect(switched.pendingKeys).toBe(1)
    // The second entry (office-oxford) was never sent after the switch and remains in user-1's key
    const remainingAfterSwitch = JSON.parse(window.localStorage.getItem(key) ?? '[]') as {
      lookId: string
    }[]
    expect(remainingAfterSwitch.map((b) => b.lookId)).toEqual(['sample:l:office-oxford'])

    // 4. Malformed payload removal, unverified/signed-out early exit, and failed garment load fallback
    currentWebSessionOwner.mockReturnValue('user-1')
    expect(await importLegacyDeviceSavedLooksFromWeb({ owner: 'bearer' })).toEqual({
      imported: [],
      pendingKeys: 0,
    })
    window.localStorage.setItem(key, '{malformed-json')
    const malformedResult = await importLegacyDeviceSavedLooksFromWeb({
      owner: 'user-1',
    })
    expect(malformedResult.pendingKeys).toBe(0)
    expect(window.localStorage.getItem(key)).toBeNull()

    const styleKey = stylePieceStorageKey('user-1', 'garment-1')
    window.localStorage.setItem(
      styleKey,
      JSON.stringify([
        { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
      ])
    )
    listGarmentsFromWeb.mockRejectedValueOnce(new Error('wardrobe offline'))
    const failedGarmentLoad = await importLegacyDeviceSavedLooksFromWeb({
      owner: 'user-1',
    })
    expect(failedGarmentLoad.pendingKeys).toBe(1)
    expect(window.localStorage.getItem(styleKey)).not.toBeNull()
  })
})
