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
  apiV1WardrobeSavedLooksSavedLookIdRestorePost,
  resolveMobileAccessToken,
} = vi.hoisted(() => ({
  apiV1WardrobeSavedLooksGet: vi.fn(),
  apiV1WardrobeSavedLooksPost: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdGet: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdDelete: vi.fn(),
  apiV1WardrobeSavedLooksSavedLookIdRestorePost: vi.fn(),
  resolveMobileAccessToken: vi.fn<() => Promise<string | null>>(() =>
    Promise.resolve('mobile-token')
  ),
}))

vi.mock('./api-client', () => ({
  createMobileApiClient: () => ({
    apiV1WardrobeSavedLooksGet,
    apiV1WardrobeSavedLooksPost,
    apiV1WardrobeSavedLooksSavedLookIdGet,
    apiV1WardrobeSavedLooksSavedLookIdDelete,
    apiV1WardrobeSavedLooksSavedLookIdRestorePost,
  }),
}))

vi.mock('./mobile-auth', () => ({
  resolveMobileAccessToken,
}))

import {
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  getSavedLookFromMobile,
  listSavedLooksFromMobile,
  listSavedLooksPageFromMobile,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
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
})
