// Story CC-7.2 & CC-7.3: In-memory MSW handlers for mobile account-backed saved looks tests.
import { http, HttpResponse } from 'msw'
import {
  createSavedLookInputSchema,
  type SavedLookContract,
  type SavedLookNeedsReviewReason,
} from '@couture/api-client/contracts/http'
import {
  doesSavedLookResolve,
  type ComfortRange,
  type SampleGarmentCategory,
} from '@couture/utils'

export type MobileSavedLooksMswStore = {
  items: SavedLookContract[]
  deletedItems: Map<string, SavedLookContract>
  idempotencyKeys: Map<string, SavedLookContract>
  unownedGarmentIds: Set<string>
  garmentTagsById: Map<
    string,
    { category: SampleGarmentCategory; comfortRange: ComfortRange }
  >
  nextPostError?: () => Response | null
  nextDeleteError?: () => Response | null
  nextRestoreError?: () => Response | null
  nextGetError?: () => Response | null
  onGet?: (request: Request) => void | Promise<void>
  onPost?: (request: Request) => void | Promise<void>
  onDelete?: (request: Request, id: string) => void | Promise<void>
  onRestore?: (request: Request, id: string) => void | Promise<void>
}

function deriveMswSavedLookAvailability(
  parsed: ReturnType<typeof createSavedLookInputSchema.parse>,
  store: MobileSavedLooksMswStore
): {
  availabilityStatus: 'ready' | 'needs_review'
  needsReviewReasons: SavedLookNeedsReviewReason[]
} {
  const liveTags = parsed.anchorGarmentId
    ? store.garmentTagsById.get(parsed.anchorGarmentId)
    : undefined
  const anchorCategory =
    liveTags?.category ??
    parsed.composition.find((slot) => slot.kind === 'garment')?.category ??
    parsed.anchorSnapshot?.category ??
    null
  const anchorComfortRange =
    liveTags?.comfortRange ?? parsed.anchorSnapshot?.comfortRange ?? null
  const resolves = doesSavedLookResolve({
    source: parsed.source,
    lookId: parsed.lookId,
    weather: parsed.weather,
    anchorCategory,
    anchorComfortRange,
    swaps: parsed.swaps,
    collection: parsed.collection ?? null,
    comfort: parsed.comfort ?? null,
  })
  return {
    availabilityStatus: !resolves ? 'needs_review' : 'ready',
    needsReviewReasons: [],
  }
}

function buildMswCreatedSavedLook(
  id: string,
  owner: string,
  parsed: ReturnType<typeof createSavedLookInputSchema.parse>,
  store: MobileSavedLooksMswStore
): SavedLookContract {
  const { availabilityStatus, needsReviewReasons } = deriveMswSavedLookAvailability(
    parsed,
    store
  )
  const liveTags = parsed.anchorGarmentId
    ? store.garmentTagsById.get(parsed.anchorGarmentId)
    : undefined
  const authoritativeSnapshot =
    parsed.source === 'style_piece' && parsed.anchorGarmentId
      ? liveTags
        ? {
            garmentId: parsed.anchorGarmentId,
            category: liveTags.category,
            comfortRange: liveTags.comfortRange,
          }
        : (parsed.anchorSnapshot ?? null)
      : null
  const now = new Date().toISOString()
  return {
    id,
    ownerUserId: owner,
    source: parsed.source === 'today' ? 'home_sample' : parsed.source,
    lookId: parsed.lookId,
    ...(parsed.wornOn ? { wornOn: parsed.wornOn } : {}),
    weather: parsed.weather,
    title: parsed.title ?? null,
    anchorGarmentId: parsed.anchorGarmentId ?? null,
    anchorSnapshot: authoritativeSnapshot,
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
    availabilityStatus,
    missingGarmentIds: [],
    needsReviewReasons,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function formatMswSavedLookForRead(
  item: SavedLookContract,
  store: MobileSavedLooksMswStore
): SavedLookContract {
  if (item.availabilityStatus === 'missing_garment') return item
  const liveTags = item.anchorGarmentId
    ? store.garmentTagsById.get(item.anchorGarmentId)
    : undefined
  if (!liveTags) return item
  const reasons: SavedLookNeedsReviewReason[] = []
  if (item.source === 'style_piece' && item.anchorSnapshot) {
    if (liveTags.category !== item.anchorSnapshot.category) {
      reasons.push('category_changed')
    }
    if (liveTags.comfortRange !== item.anchorSnapshot.comfortRange) {
      reasons.push('comfort_range_changed')
    }
  }
  const resolves = doesSavedLookResolve({
    source: item.source,
    lookId: item.lookId,
    weather: item.weather,
    anchorCategory: liveTags.category,
    anchorComfortRange: liveTags.comfortRange,
    swaps: item.swaps,
    collection: item.collection,
    comfort: item.comfort,
  })
  return {
    ...item,
    availabilityStatus: reasons.length > 0 || !resolves ? 'needs_review' : 'ready',
    needsReviewReasons: reasons,
  }
}

export function createSavedLooksMswHandlers(
  initial: SavedLookContract[] = [],
  basePattern = '*/api/v1/wardrobe/saved-looks'
) {
  let seq = 1
  const store: MobileSavedLooksMswStore = {
    items: [...initial],
    deletedItems: new Map(),
    idempotencyKeys: new Map(),
    unownedGarmentIds: new Set(),
    garmentTagsById: new Map(),
  }

  const ownerFromRequest = (request: Request) =>
    request.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim() || 'anonymous'

  const handlers = [
    http.get(basePattern, async ({ request }) => {
      const snapshot = [...store.items]
      const hadOnGet = Boolean(store.onGet)
      if (store.onGet) await store.onGet(request)
      const errorRes = store.nextGetError?.()
      if (errorRes) return errorRes
      const owner = ownerFromRequest(request)
      const url = new URL(request.url)
      const source = url.searchParams.get('source')
      const includeToday = url.searchParams.get('includeToday') === 'true'
      const anchorGarmentId = url.searchParams.get('anchorGarmentId')
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const sourceItems = hadOnGet ? snapshot : store.items
      const filtered = sourceItems.filter(
        (item) =>
          item.ownerUserId === owner &&
          (item.wornOn
            ? source === 'today' ||
              (includeToday && (!source || source === 'home_sample'))
            : !source || item.source === source) &&
          (!anchorGarmentId || item.anchorGarmentId === anchorGarmentId)
      )
      const page = filtered
        .slice(offset, offset + limit)
        .map((item) => formatMswSavedLookForRead(item, store))
      return HttpResponse.json({
        data: page,
        total: filtered.length,
        limit,
        offset,
      })
    }),
    http.get(`${basePattern}/:savedLookId`, ({ request, params }) => {
      const errorRes = store.nextGetError?.()
      if (errorRes) return errorRes
      const id = String(params.savedLookId)
      const owner = ownerFromRequest(request)
      const found = store.items.find(
        (item) => item.id === id && item.ownerUserId === owner
      )
      if (!found) {
        return HttpResponse.json(
          { statusCode: 404, message: 'SAVED_LOOK_NOT_FOUND', error: 'Not Found' },
          { status: 404 }
        )
      }
      const formatted = formatMswSavedLookForRead(found, store)
      return HttpResponse.json(
        { data: formatted },
        {
          status: 200,
          headers: { ETag: `"saved-look:${formatted.id}:${formatted.revision}"` },
        }
      )
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
        if (store.deletedItems.has(existing.id)) {
          return HttpResponse.json(
            {
              statusCode: 409,
              message: 'SAVED_LOOK_ALREADY_REMOVED',
              error: 'Conflict',
            },
            { status: 409 }
          )
        }
        return HttpResponse.json(
          { data: existing },
          {
            status: 200,
            headers: { ETag: `"saved-look:${existing.id}:${existing.revision}"` },
          }
        )
      }
      const parsed = createSavedLookInputSchema.parse(await request.json())
      const referencedGarments = [
        ...(parsed.anchorGarmentId ? [parsed.anchorGarmentId] : []),
        ...parsed.composition
          .filter((slot) => slot.kind === 'garment')
          .map((slot) => slot.itemId),
      ]
      if (referencedGarments.some((id) => store.unownedGarmentIds.has(id))) {
        return HttpResponse.json(
          { statusCode: 404, message: 'GARMENT_NOT_FOUND', error: 'Not Found' },
          { status: 404 }
        )
      }
      const created = buildMswCreatedSavedLook(
        `saved-look-m-${seq++}`,
        owner,
        parsed,
        store
      )
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
    http.post(`${basePattern}/:savedLookId/restore`, async ({ request, params }) => {
      const id = String(params.savedLookId)
      if (store.onRestore) await store.onRestore(request, id)
      const errorRes = store.nextRestoreError?.() ?? store.nextPostError?.()
      if (errorRes) return errorRes
      const owner = ownerFromRequest(request)
      const active = store.items.find(
        (item) => item.id === id && item.ownerUserId === owner
      )
      if (active) {
        return HttpResponse.json(
          { data: active },
          {
            status: 200,
            headers: { ETag: `"saved-look:${active.id}:${active.revision}"` },
          }
        )
      }
      const deleted = store.deletedItems.get(id)
      if (!deleted || deleted.ownerUserId !== owner) {
        return HttpResponse.json(
          { statusCode: 404, message: 'SAVED_LOOK_NOT_FOUND', error: 'Not Found' },
          { status: 404 }
        )
      }
      const restored: SavedLookContract = {
        ...deleted,
        revision: deleted.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      store.deletedItems.delete(id)
      store.items = [restored, ...store.items.filter((item) => item.id !== id)]
      return HttpResponse.json(
        { data: restored },
        {
          status: 200,
          headers: { ETag: `"saved-look:${restored.id}:${restored.revision}"` },
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
      if (
        ifMatch !== '*' &&
        !ifMatch
          .split(',')
          .map((s) => s.trim())
          .includes(expected)
      ) {
        return HttpResponse.json(
          {
            statusCode: 412,
            message: 'SAVED_LOOK_REVISION_MISMATCH',
            error: 'Precondition Failed',
          },
          { status: 412 }
        )
      }
      store.deletedItems.set(id, { ...existing, revision: existing.revision + 1 })
      store.items = store.items.filter((item) => item.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
  ]

  return { store, handlers }
}
