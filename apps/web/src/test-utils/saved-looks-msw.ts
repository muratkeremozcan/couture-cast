// Story CC-7.2: In-memory MSW handlers for account-backed saved looks tests.
import { http, HttpResponse } from 'msw'
import {
  createSavedLookInputSchema,
  type SavedLookContract,
} from '@couture/api-client/contracts/http'

export type SavedLooksMswStore = {
  items: SavedLookContract[]
  idempotencyKeys: Map<string, SavedLookContract>
  nextPostError?: () => Response | null
  nextDeleteError?: () => Response | null
  nextGetError?: () => Response | null
  onPost?: (request: Request) => void | Promise<void>
  onDelete?: (request: Request, id: string) => void | Promise<void>
}

export function createSavedLooksMswHandlers(
  initial: SavedLookContract[] = [],
  basePattern = '*/api/v1/wardrobe/saved-looks'
) {
  let seq = 1
  const store: SavedLooksMswStore = {
    items: [...initial],
    idempotencyKeys: new Map(),
  }

  const ownerFromRequest = (request: Request) =>
    request.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim() || 'anonymous'

  const handlers = [
    http.get(basePattern, ({ request }) => {
      const errorRes = store.nextGetError?.()
      if (errorRes) return errorRes
      const owner = ownerFromRequest(request)
      const url = new URL(request.url)
      const source = url.searchParams.get('source')
      const anchorGarmentId = url.searchParams.get('anchorGarmentId')
      const filtered = store.items.filter(
        (item) =>
          item.ownerUserId === owner &&
          (!source || item.source === source) &&
          (!anchorGarmentId || item.anchorGarmentId === anchorGarmentId)
      )
      return HttpResponse.json({
        data: filtered,
        total: filtered.length,
        limit: 50,
        offset: 0,
      })
    }),
    http.post(basePattern, async ({ request }) => {
      if (store.onPost) await store.onPost(request)
      const errorRes = store.nextPostError?.()
      if (errorRes) return errorRes
      const owner = ownerFromRequest(request)
      const idemKey = request.headers.get('Idempotency-Key')
      const scopedKey = idemKey ? `${owner}:${idemKey}` : null
      if (scopedKey && store.idempotencyKeys.has(scopedKey)) {
        const existing = store.idempotencyKeys.get(scopedKey)!
        return HttpResponse.json(
          { data: existing },
          {
            status: 200,
            headers: { ETag: `"saved-look:${existing.id}:${existing.revision}"` },
          }
        )
      }
      const parsed = createSavedLookInputSchema.parse(await request.json())
      const now = new Date().toISOString()
      const created: SavedLookContract = {
        id: `saved-look-${seq++}`,
        ownerUserId: owner,
        source: parsed.source,
        lookId: parsed.lookId,
        weather: parsed.weather,
        title: parsed.title ?? null,
        anchorGarmentId: parsed.anchorGarmentId ?? null,
        anchorSnapshot: parsed.anchorSnapshot ?? null,
        composition: parsed.composition.map((slot) => ({
          slotIndex: slot.slotIndex,
          category: slot.category,
          kind: slot.kind,
          itemId: slot.itemId,
          label: slot.label ?? null,
          missing: false,
          imageAccess: null,
        })),
        swaps: parsed.swaps ?? {},
        collection: parsed.collection ?? null,
        comfort: parsed.comfort ?? null,
        availabilityStatus: 'ready',
        missingGarmentIds: [],
        needsReviewReasons: [],
        revision: 0,
        createdAt: now,
        updatedAt: now,
      }
      store.items = [created, ...store.items]
      if (scopedKey) store.idempotencyKeys.set(scopedKey, created)
      return HttpResponse.json(
        { data: created },
        {
          status: 201,
          headers: { ETag: `"saved-look:${created.id}:${created.revision}"` },
        }
      )
    }),
    http.delete(`${basePattern}/:savedLookId`, async ({ request, params }) => {
      const id = String(params.savedLookId)
      if (store.onDelete) await store.onDelete(request, id)
      const errorRes = store.nextDeleteError?.()
      if (errorRes) return errorRes
      const owner = ownerFromRequest(request)
      const ifMatch = request.headers.get('If-Match')
      if (!ifMatch) {
        return HttpResponse.json(
          {
            statusCode: 428,
            message: 'PRECONDITION_REQUIRED',
            error: 'Precondition Required',
          },
          { status: 428 }
        )
      }
      const existing = store.items.find(
        (item) => item.id === id && item.ownerUserId === owner
      )
      if (!existing) {
        return HttpResponse.json(
          { statusCode: 404, message: 'SAVED_LOOK_NOT_FOUND', error: 'Not Found' },
          { status: 404 }
        )
      }
      const expected = `"saved-look:${existing.id}:${existing.revision}"`
      if (ifMatch !== '*' && ifMatch !== expected) {
        return HttpResponse.json(
          {
            statusCode: 412,
            message: 'SAVED_LOOK_REVISION_MISMATCH',
            error: 'Precondition Failed',
          },
          { status: 412 }
        )
      }
      store.items = store.items.filter((item) => item.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
  ]

  return { store, handlers }
}
