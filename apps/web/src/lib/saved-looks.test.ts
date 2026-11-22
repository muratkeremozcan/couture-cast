// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'
import type { SavedLookContract } from '@couture/api-client/contracts/http'

const {
  apiV1WardrobeSavedLooksGet,
  apiV1WardrobeSavedLooksPost,
  apiV1WardrobeSavedLooksSavedLookIdGet,
  apiV1WardrobeSavedLooksSavedLookIdDelete,
  currentWebSessionBearer,
  readStorage,
} = vi.hoisted(() => ({
  apiV1WardrobeSavedLooksGet: vi.fn(),
  apiV1WardrobeSavedLooksPost: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdGet: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdDelete: vi.fn(),
  currentWebSessionBearer: vi.fn<() => string | null>(() => 'verified-token'),
  readStorage: vi.fn<() => string | null>(() => null),
}))

vi.mock('./api-client', () => ({
  createWebApiClient: () => ({
    apiV1WardrobeSavedLooksGet,
    apiV1WardrobeSavedLooksPost,
    apiV1WardrobeSavedLooksSavedLookIdGet,
    apiV1WardrobeSavedLooksSavedLookIdDelete,
  }),
}))

vi.mock('./use-web-session', () => ({
  currentWebSessionBearer,
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
  listSavedLooksFromWeb,
  SavedLookRequestError,
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
    currentWebSessionBearer.mockReturnValue('verified-token')
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
    const single = await getSavedLookFromWeb('sl-1')
    expect(single.id).toBe('sl-1')

    apiV1WardrobeSavedLooksSavedLookIdDelete.mockResolvedValueOnce(undefined)
    await deleteSavedLookFromWeb('sl-1', formatSavedLookIfMatch('sl-1', 0))
    expect(apiV1WardrobeSavedLooksSavedLookIdDelete).toHaveBeenCalledWith(
      { savedLookId: 'sl-1', ifMatch: '"saved-look:sl-1:0"' },
      expect.anything()
    )
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
  })
})
