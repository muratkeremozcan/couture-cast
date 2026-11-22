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
  createMobileApiClientSpy,
  listGarmentsFromMobile,
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
} = vi.hoisted(() => ({
  apiV1WardrobeSavedLooksGet: vi.fn(),
  apiV1WardrobeSavedLooksPost: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdGet: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdDelete: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdRestorePost: vi.fn(),
  createMobileApiClientSpy: vi.fn<(opts?: { accessToken?: string }) => void>(),
  listGarmentsFromMobile: vi.fn<() => Promise<GarmentItemContract[]>>(() =>
    Promise.resolve([])
  ),
  mobileApplicationUserId: vi.fn<() => string | null>(() => 'user-1'),
  mobileIdentityEpoch: vi.fn<() => number>(() => 1),
  resolveMobileAccessToken: vi.fn<() => Promise<string | null>>(() =>
    Promise.resolve('mobile-token')
  ),
}))

vi.mock('./api-client', () => ({
  createMobileApiClient: (opts?: { accessToken?: string }) => {
    createMobileApiClientSpy(opts)
    return {
      apiV1WardrobeSavedLooksGet,
      apiV1WardrobeSavedLooksPost,
      apiV1WardrobeSavedLooksSavedLookIdGet,
      apiV1WardrobeSavedLooksSavedLookIdDelete,
      apiV1WardrobeSavedLooksSavedLookIdRestorePost,
    }
  },
}))

vi.mock('./mobile-auth', () => ({
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
}))

vi.mock('./wardrobe', () => ({
  listGarmentsFromMobile,
}))

import {
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  ensureMobileLegacySavedLooksMigration,
  formatSavedLookIfMatch,
  getSavedLookFromMobile,
  importLegacyDeviceSavedLooksFromMobile,
  listSavedLooksFromMobile,
  listSavedLooksPageFromMobile,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
  resetMobileLegacySavedLooksImportState,
  restoreSavedLookFromMobile,
  subscribeMobileSavedLooksChanged,
} from './saved-looks'

const SAMPLE_LOOK: SavedLookContract = {
  id: 'sl-m1',
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

describe('mobile saved-looks client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.localStorage.clear()
    resetMobileLegacySavedLooksImportState()
    mobileApplicationUserId.mockReturnValue('user-1')
    mobileIdentityEpoch.mockReturnValue(1)
    listGarmentsFromMobile.mockResolvedValue([])
    resolveMobileAccessToken.mockResolvedValue('mobile-token')
  })

  it('lists, creates with Idempotency-Key, gets, and deletes with If-Match', async () => {
    expect(formatSavedLookIfMatch('sl-m1', 1)).toBe('"saved-look:sl-m1:1"')

    apiV1WardrobeSavedLooksGet.mockResolvedValueOnce({
      data: [SAMPLE_LOOK],
      total: 1,
      limit: 50,
      offset: 0,
    })
    expect(await listSavedLooksFromMobile({ source: 'home_sample' })).toEqual([
      SAMPLE_LOOK,
    ])

    apiV1WardrobeSavedLooksPost.mockResolvedValueOnce({ data: SAMPLE_LOOK })
    const controller = new AbortController()
    const created = await createSavedLookFromMobile(
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
      {
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        signal: controller.signal,
      }
    )
    expect(created.id).toBe('sl-m1')

    apiV1WardrobeSavedLooksSavedLookIdGet.mockResolvedValueOnce({ data: SAMPLE_LOOK })
    expect(
      (await getSavedLookFromMobile('sl-m1', { signal: controller.signal })).id
    ).toBe('sl-m1')

    apiV1WardrobeSavedLooksSavedLookIdDelete.mockResolvedValueOnce(undefined)
    await deleteSavedLookFromMobile('sl-m1', formatSavedLookIfMatch('sl-m1', 0), {
      accessToken: 'pinned-token',
      signal: controller.signal,
    })
    expect(apiV1WardrobeSavedLooksSavedLookIdDelete).toHaveBeenCalledWith(
      { savedLookId: 'sl-m1', ifMatch: '"saved-look:sl-m1:0"' },
      expect.anything()
    )

    apiV1WardrobeSavedLooksGet.mockResolvedValueOnce({
      data: [SAMPLE_LOOK],
      total: 51,
      limit: 50,
      offset: 0,
    })
    const page = await listSavedLooksPageFromMobile({
      limit: 50,
      offset: 0,
      signal: controller.signal,
    })
    expect(page.total).toBe(51)
    expect(page.data).toEqual([SAMPLE_LOOK])

    apiV1WardrobeSavedLooksSavedLookIdRestorePost.mockResolvedValueOnce({
      data: { ...SAMPLE_LOOK, revision: 1 },
    })
    const restored = await restoreSavedLookFromMobile('sl-m1', {
      accessToken: 'pinned-token',
      signal: controller.signal,
    })
    expect(restored.revision).toBe(1)

    const events: (string | null)[] = []
    const unsub = subscribeMobileSavedLooksChanged((owner) => events.push(owner))
    notifyMobileSavedLooksChanged('user-1')
    unsub()
    notifyMobileSavedLooksChanged('user-1')
    expect(events).toEqual(['user-1'])
  })

  it('throws normalized errors on missing token, non-JSON HTTP error, and generic failures', async () => {
    resolveMobileAccessToken.mockResolvedValueOnce(null)
    await expect(listSavedLooksFromMobile()).rejects.toBeInstanceOf(
      MobileSavedLookRequestError
    )

    apiV1WardrobeSavedLooksPost.mockRejectedValueOnce(
      new ResponseError(
        new Response(
          JSON.stringify({ message: 'GARMENT_NOT_FOUND', code: 'GARMENT_NOT_FOUND' }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
    )
    await expect(
      createSavedLookFromMobile({
        source: 'home_sample',
        lookId: 'look-01',
        weather: 'mild-dry',
        composition: [
          { slotIndex: 0, category: 'top', kind: 'catalog', itemId: 'sample:g:top-1' },
        ],
        swaps: {},
      })
    ).rejects.toMatchObject({
      status: 404,
      code: 'GARMENT_NOT_FOUND',
      message: 'GARMENT_NOT_FOUND',
    })

    apiV1WardrobeSavedLooksSavedLookIdRestorePost.mockRejectedValueOnce(
      new ResponseError(new Response('bad gateway', { status: 502 }))
    )
    await expect(restoreSavedLookFromMobile('sl-m1')).rejects.toMatchObject({
      status: 502,
    })

    apiV1WardrobeSavedLooksSavedLookIdGet.mockRejectedValueOnce(
      new ResponseError(
        new Response(JSON.stringify({ code: 'CODE_ONLY' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    await expect(getSavedLookFromMobile('sl-m1')).rejects.toMatchObject({
      status: 400,
      code: 'CODE_ONLY',
    })

    apiV1WardrobeSavedLooksSavedLookIdGet.mockRejectedValueOnce('raw-error')
    await expect(getSavedLookFromMobile('sl-m1')).rejects.toThrow(
      'Unable to open this saved look.'
    )

    apiV1WardrobeSavedLooksSavedLookIdDelete.mockRejectedValueOnce(
      new Error('network boom')
    )
    await expect(deleteSavedLookFromMobile('sl-m1', '*')).rejects.toThrow('network boom')
  })

  it('imports same-member device-saved looks on mobile, preserves unresolved looks into needs_review, rejects tampered references, and isolates other accounts', async () => {
    const guestRaw = JSON.stringify({ schemaVersion: 1, weather: 'mild-dry' })
    const user2Raw = JSON.stringify([
      {
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        swaps: {},
      },
    ])
    const user2StyleKey = stylePieceStorageKey('user-2', 'garment-b')
    globalThis.localStorage.setItem('couturecast.guest-preview.v1', guestRaw)
    globalThis.localStorage.setItem(
      'couturecast.member-sample-bookmarks.user-2',
      user2Raw
    )
    globalThis.localStorage.setItem(
      user2StyleKey,
      '[{"lookId":"sample:l:office-oxford","weather":"mild-dry","swaps":{}}]'
    )

    const user1BookmarksKey = 'couturecast.member-sample-bookmarks.user-1'
    globalThis.localStorage.setItem(
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
    const user1StyleKey = stylePieceStorageKey('user-1', 'garment-changed')
    const user1TamperedKey = stylePieceStorageKey('user-1', 'garment-other-user')
    globalThis.localStorage.setItem(
      user1StyleKey,
      JSON.stringify([
        {
          lookId: 'sample:l:silk-midi',
          weather: 'warm-rainy',
          swaps: { shoes: 'sample:g:loafers' },
        },
      ])
    )
    globalThis.localStorage.setItem(
      user1TamperedKey,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: {},
        },
      ])
    )

    listGarmentsFromMobile.mockResolvedValue([
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
        createSavedLookInput,
      }: {
        createSavedLookInput: {
          source: 'style_piece' | 'home_sample'
          lookId: string
          weather: string
          anchorGarmentId?: string | null
        }
      }) => {
        if (createSavedLookInput.anchorGarmentId === 'garment-other-user') {
          return Promise.reject(
            new ResponseError(
              new Response(
                JSON.stringify({
                  message: 'GARMENT_NOT_FOUND',
                  code: 'GARMENT_NOT_FOUND',
                }),
                { status: 404, headers: { 'content-type': 'application/json' } }
              )
            )
          )
        }
        const isNeedsReview =
          createSavedLookInput.lookId === 'sample:l:summer-linen' ||
          createSavedLookInput.anchorGarmentId === 'garment-changed'
        const record: SavedLookContract = {
          ...SAMPLE_LOOK,
          id: `m-imported-${createdRecords.length + 1}`,
          source: createSavedLookInput.source,
          lookId: createSavedLookInput.lookId,
          weather: createSavedLookInput.weather,
          anchorGarmentId: createSavedLookInput.anchorGarmentId ?? null,
          availabilityStatus: isNeedsReview ? 'needs_review' : 'ready',
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

    const migrated = await importLegacyDeviceSavedLooksFromMobile()
    expect(migrated.pendingKeys).toBe(0)
    expect(migrated.imported).toHaveLength(3)
    const items = await listSavedLooksFromMobile()
    expect(items).toHaveLength(3)
    expect(
      items.find((item) => item.lookId === 'sample:l:summer-linen')?.availabilityStatus
    ).toBe('needs_review')
    expect(
      items.find((item) => item.anchorGarmentId === 'garment-changed')?.availabilityStatus
    ).toBe('needs_review')

    expect(globalThis.localStorage.getItem(user1BookmarksKey)).toBeNull()
    expect(globalThis.localStorage.getItem(user1StyleKey)).toBeNull()
    expect(globalThis.localStorage.getItem(user1TamperedKey)).toBeNull()
    expect(globalThis.localStorage.getItem('couturecast.guest-preview.v1')).toBe(guestRaw)
    expect(
      globalThis.localStorage.getItem('couturecast.member-sample-bookmarks.user-2')
    ).toBe(user2Raw)
    expect(globalThis.localStorage.getItem(user2StyleKey)).not.toBeNull()
  })

  it('retries failed mobile imports with the same Idempotency-Key, deduplicates concurrent retries, and fences on epoch/user switch', async () => {
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
    globalThis.localStorage.setItem(key, rawBookmarks)

    const seenKeys: string[] = []
    apiV1WardrobeSavedLooksPost
      .mockImplementationOnce(({ idempotencyKey }: { idempotencyKey: string }) => {
        seenKeys.push(idempotencyKey)
        return Promise.resolve({ data: { ...SAMPLE_LOOK, id: 'm-city-wool' } })
      })
      .mockImplementationOnce(({ idempotencyKey }: { idempotencyKey: string }) => {
        seenKeys.push(idempotencyKey)
        return Promise.reject(new ResponseError(new Response('503', { status: 503 })))
      })

    const first = await importLegacyDeviceSavedLooksFromMobile()
    expect(first.imported).toHaveLength(1)
    expect(first.pendingKeys).toBe(1)

    const dedupMap = new Map<string, SavedLookContract>()
    apiV1WardrobeSavedLooksPost.mockImplementation(
      ({ idempotencyKey }: { idempotencyKey: string }) => {
        seenKeys.push(idempotencyKey)
        const existing = dedupMap.get(idempotencyKey)
        if (existing) return Promise.resolve({ data: existing })
        const created = { ...SAMPLE_LOOK, id: 'm-office-oxford' }
        dedupMap.set(idempotencyKey, created)
        return Promise.resolve({ data: created })
      }
    )

    const [c1, c2] = await Promise.all([
      importLegacyDeviceSavedLooksFromMobile(),
      importLegacyDeviceSavedLooksFromMobile(),
    ])
    expect(dedupMap.size).toBe(1)
    expect(seenKeys[1]).toBe(seenKeys[2])
    expect(seenKeys[2]).toBe(seenKeys[3])
    expect(c1.pendingKeys).toBe(0)
    expect(c2.pendingKeys).toBe(0)
    expect(globalThis.localStorage.getItem(key)).toBeNull()

    // Epoch/account switch mid-import fences the in-flight run with pinned token and leaves storage untouched
    resetMobileLegacySavedLooksImportState()
    createMobileApiClientSpy.mockClear()
    resolveMobileAccessToken.mockResolvedValue('mobile-token-user-1')
    mobileApplicationUserId.mockReturnValue('user-1')
    mobileIdentityEpoch.mockReturnValue(1)
    globalThis.localStorage.setItem(key, rawBookmarks)
    apiV1WardrobeSavedLooksPost.mockImplementationOnce(() => {
      mobileApplicationUserId.mockReturnValue('user-2')
      mobileIdentityEpoch.mockReturnValue(2)
      resolveMobileAccessToken.mockResolvedValue('mobile-token-user-2')
      return Promise.resolve({ data: { ...SAMPLE_LOOK, id: 'm-city-wool' } })
    })
    const switched = await importLegacyDeviceSavedLooksFromMobile({
      owner: 'user-1',
      epoch: 1,
      notify: true,
    })
    expect(switched.pendingKeys).toBe(1)
    expect(switched.imported).toEqual([])
    expect(createMobileApiClientSpy).toHaveBeenCalledWith({
      accessToken: 'mobile-token-user-1',
    })
    expect(createMobileApiClientSpy).not.toHaveBeenCalledWith({
      accessToken: 'mobile-token-user-2',
    })
    const remaining = JSON.parse(globalThis.localStorage.getItem(key) ?? '[]') as {
      lookId: string
    }[]
    expect(remaining.map((b) => b.lookId)).toEqual([
      'sample:l:office-oxford',
      'sample:l:city-wool',
    ])

    // Same-member re-entry with a new epoch (epoch 3) resumes and completes with idempotent replay
    mobileApplicationUserId.mockReturnValue('user-1')
    mobileIdentityEpoch.mockReturnValue(3)
    resolveMobileAccessToken.mockResolvedValue('mobile-token-user-1-reentry')
    apiV1WardrobeSavedLooksPost.mockResolvedValue({
      data: { ...SAMPLE_LOOK, id: 'm-resumed' },
    })
    const resumed = await importLegacyDeviceSavedLooksFromMobile({
      owner: 'user-1',
      epoch: 3,
    })
    expect(resumed.pendingKeys).toBe(0)
    expect(resumed.imported).toHaveLength(2)
    expect(globalThis.localStorage.getItem(key)).toBeNull()

    // Malformed payload cleanup, signed-out guard, and failed garment load retention
    mobileApplicationUserId.mockReturnValue('user-1')
    mobileIdentityEpoch.mockReturnValue(1)
    resolveMobileAccessToken.mockResolvedValue('mobile-token')
    expect(await importLegacyDeviceSavedLooksFromMobile({ owner: '' })).toEqual({
      imported: [],
      pendingKeys: 0,
    })
    globalThis.localStorage.setItem(key, '{bad-json')
    expect((await importLegacyDeviceSavedLooksFromMobile()).pendingKeys).toBe(0)
    expect(globalThis.localStorage.getItem(key)).toBeNull()

    const styleKey = stylePieceStorageKey('user-1', 'garment-1')
    globalThis.localStorage.setItem(
      styleKey,
      JSON.stringify([
        { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
      ])
    )
    listGarmentsFromMobile.mockRejectedValueOnce(new Error('offline'))
    expect((await importLegacyDeviceSavedLooksFromMobile()).pendingKeys).toBe(1)
    expect(globalThis.localStorage.getItem(styleKey)).not.toBeNull()
  })

  it('covers mobile 409 choice reconciliation, concurrent edit retention, deadlines, source filters, and shared key budgets', async () => {
    const key = 'couturecast.member-sample-bookmarks.user-1'
    const styleKey = stylePieceStorageKey('user-1', 'garment-custom')
    const editedBookmark = {
      lookId: 'sample:l:office-oxford',
      weather: 'mild-dry',
      collection: 'all',
      comfort: DEFAULT_SAMPLE_COMFORT,
      swaps: { shoes: 'sample:g:white-sneakers' },
    }
    const seenOwners: (string | null)[] = []
    const unsub = subscribeMobileSavedLooksChanged((o) => seenOwners.push(o))

    // 1. Source filtering, custom loadGarments, and notify callback
    globalThis.localStorage.setItem(key, JSON.stringify([editedBookmark]))
    globalThis.localStorage.setItem(
      styleKey,
      JSON.stringify([
        { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
      ])
    )
    apiV1WardrobeSavedLooksPost.mockResolvedValue({ data: SAMPLE_LOOK })
    const homeOnly = await importLegacyDeviceSavedLooksFromMobile({
      sources: ['home_sample'],
      notify: true,
    })
    expect(homeOnly.imported).toHaveLength(1)
    expect(seenOwners).toEqual(['user-1'])
    expect(globalThis.localStorage.getItem(styleKey)).not.toBeNull()

    const customLoad = vi.fn().mockResolvedValue([
      {
        id: 'garment-custom',
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
    const styleOnly = await importLegacyDeviceSavedLooksFromMobile({
      sources: ['style_piece'],
      loadGarments: customLoad,
      notify: true,
    })
    expect(customLoad).toHaveBeenCalledTimes(1)
    expect(styleOnly.imported).toHaveLength(1)
    expect(globalThis.localStorage.getItem(styleKey)).toBeNull()
    unsub()

    // 2. Unrelated 404 retains entry, while 409 conflict verifies saved choices and paginates across pages
    resetMobileLegacySavedLooksImportState()
    globalThis.localStorage.setItem(key, JSON.stringify([editedBookmark]))
    apiV1WardrobeSavedLooksPost.mockRejectedValueOnce(
      new ResponseError(
        new Response(JSON.stringify({ message: 'ROUTE_NOT_FOUND' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    expect((await importLegacyDeviceSavedLooksFromMobile()).pendingKeys).toBe(1)

    // 409 mismatching swaps -> retained
    apiV1WardrobeSavedLooksPost.mockRejectedValueOnce(
      new ResponseError(
        new Response(
          JSON.stringify({
            message: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    apiV1WardrobeSavedLooksGet.mockResolvedValueOnce({
      data: [
        {
          ...SAMPLE_LOOK,
          id: 'm-diff-swaps',
          source: 'home_sample',
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: { shoes: 'sample:g:loafers' },
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })
    expect((await importLegacyDeviceSavedLooksFromMobile()).pendingKeys).toBe(1)

    // 409 paginated match on page 2 -> reconciled & removed
    apiV1WardrobeSavedLooksPost.mockRejectedValueOnce(
      new ResponseError(
        new Response(
          JSON.stringify({
            message: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    apiV1WardrobeSavedLooksGet
      .mockResolvedValueOnce({
        data: [
          {
            ...SAMPLE_LOOK,
            id: 'm-page-1-other',
            source: 'home_sample',
            lookId: 'sample:l:city-wool',
            weather: 'cool-windy',
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      })
      .mockResolvedValueOnce({
        data: [
          {
            ...SAMPLE_LOOK,
            id: 'm-page-2-match',
            source: 'home_sample',
            lookId: 'sample:l:office-oxford',
            weather: 'mild-dry',
            swaps: { shoes: 'sample:g:white-sneakers' },
          },
        ],
        total: 2,
        limit: 50,
        offset: 1,
      })
    const reconciled = await importLegacyDeviceSavedLooksFromMobile()
    expect(reconciled.pendingKeys).toBe(0)
    expect(reconciled.imported.map((item) => item.id)).toEqual(['m-page-2-match'])
    expect(globalThis.localStorage.getItem(key)).toBeNull()

    // 409 GET error degrades cleanly
    resetMobileLegacySavedLooksImportState()
    globalThis.localStorage.setItem(key, JSON.stringify([editedBookmark]))
    apiV1WardrobeSavedLooksPost.mockRejectedValueOnce(
      new ResponseError(
        new Response(
          JSON.stringify({
            message: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    apiV1WardrobeSavedLooksGet.mockRejectedValueOnce(new Error('offline'))
    expect((await importLegacyDeviceSavedLooksFromMobile()).pendingKeys).toBe(1)

    // 3. Concurrent edit of same bookmark's swaps during POST retains edited entry
    resetMobileLegacySavedLooksImportState()
    const modified = { ...editedBookmark, swaps: { shoes: 'sample:g:loafers' } }
    apiV1WardrobeSavedLooksPost.mockImplementationOnce(() => {
      globalThis.localStorage.setItem(key, JSON.stringify([modified]))
      return Promise.resolve({ data: SAMPLE_LOOK })
    })
    expect((await importLegacyDeviceSavedLooksFromMobile()).pendingKeys).toBe(1)
    expect(globalThis.localStorage.getItem(key)).toBe(JSON.stringify([modified]))

    // 4. ensureMobileLegacySavedLooksMigration dedup, error catch, shared 32-key budget, and expired deadline
    resetMobileLegacySavedLooksImportState()
    expect(ensureMobileLegacySavedLooksMigration({ owner: '' })).toBeNull()
    apiV1WardrobeSavedLooksPost.mockResolvedValue({ data: SAMPLE_LOOK })
    const m1 = ensureMobileLegacySavedLooksMigration({ owner: 'user-1', epoch: 1 })
    const m2 = ensureMobileLegacySavedLooksMigration({ owner: 'user-1', epoch: 1 })
    expect(m1).toBe(m2)
    expect((await m1)?.pendingKeys).toBe(0)

    resolveMobileAccessToken.mockResolvedValueOnce(null)
    globalThis.localStorage.setItem(key, JSON.stringify([editedBookmark]))
    expect(
      await ensureMobileLegacySavedLooksMigration({ owner: 'user-1', epoch: 1 })
    ).toEqual({
      imported: [],
      pendingKeys: 0,
    })
    resolveMobileAccessToken.mockResolvedValue('mobile-token')

    // Shared 32-key budget across Home (1) + Style (33) defers excess keys
    for (let i = 0; i < 33; i += 1) {
      globalThis.localStorage.setItem(
        stylePieceStorageKey('user-1', `m-budget-${i}`),
        JSON.stringify([
          { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
        ])
      )
    }
    const budgetRun = await importLegacyDeviceSavedLooksFromMobile({ garments: [] })
    expect(budgetRun.pendingKeys).toBeGreaterThanOrEqual(2)

    // Pre-expired deadline stops work cleanly & keeps pending keys
    globalThis.localStorage.clear()
    globalThis.localStorage.setItem(key, JSON.stringify([editedBookmark]))
    globalThis.localStorage.setItem(
      styleKey,
      JSON.stringify([
        { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
      ])
    )
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValue(25_000)
    const expired = await importLegacyDeviceSavedLooksFromMobile()
    nowSpy.mockRestore()
    expect(expired.pendingKeys).toBe(2)

    // Mid-flight AbortSignal cancels cleanly
    const abortCtrl = new AbortController()
    apiV1WardrobeSavedLooksPost.mockImplementationOnce(() => {
      abortCtrl.abort()
      return Promise.reject(new Error('aborted'))
    })
    const aborted = await importLegacyDeviceSavedLooksFromMobile({
      sources: ['home_sample'],
      signal: abortCtrl.signal,
    })
    expect(aborted.pendingKeys).toBe(1)

    // Blocked localStorage degrades cleanly
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(await importLegacyDeviceSavedLooksFromMobile()).toEqual({
      imported: [],
      pendingKeys: 0,
    })
    getSpy.mockRestore()
  })
})
