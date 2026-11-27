// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): a stateful stand-in for the saved looks, capsules and planner
// reads behind the Looks tab, on top of the CC-7.7 shell fixture. The lists honour `sort`,
// `source`, `limit` and `offset` the way the API does (created_at desc, id asc), so a spec can
// seed an exact order, page past 50 and watch which reads the page sends.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import type { Page, Request, Route } from '@playwright/test'
import {
  outfitCapsuleListResponseSchema,
  outfitCapsuleResponseSchema,
  PREMIUM_REQUIRED_MESSAGE,
  savedLookListResponseSchema,
  savedLookResponseSchema,
} from '@couture/api-client/contracts/http'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { openFixtureShell } from './app-shell'
import type { ShellMode } from './shell-fixtures'

const BASE = Date.parse('2026-11-20T12:00:00.000Z')

/** ISO time `minutes` after the fixture base, so seeds read as an order. */
export const minutesAfter = (minutes: number) =>
  new Date(BASE + minutes * 60_000).toISOString()

export interface LookSeed {
  id: string
  /** Minutes after the fixture base; larger is newer. */
  created: number
  /** Default `home_sample` (the Today filter). */
  source?: 'home_sample' | 'style_piece'
  title?: string | null
  /** Garments of this look the member no longer has. */
  missing?: number
  needsReview?: boolean
}

export interface CapsuleSeed {
  id: string
  created: number
  name: string
  unavailable?: number
}

function lookContract(memberId: string, seed: LookSeed) {
  // Real sample catalog ids (`sample:g:<slug>`), so tiles draw catalog art as members see it.
  const slots = [
    ['top', 'sample:g:oxford-shirt'],
    ['bottom', 'sample:g:dark-jeans'],
    ['shoes', 'sample:g:loafers'],
    ['outerwear', 'sample:g:wool-overcoat'],
  ] as const
  const missingIds = Array.from(
    { length: seed.missing ?? 0 },
    (_, index) => `${seed.id}-gone-${index}`
  )
  const at = minutesAfter(seed.created)
  return {
    id: seed.id,
    ownerUserId: memberId,
    source: seed.source ?? 'home_sample',
    lookId: `sample:l:${seed.id}`,
    weather: 'mild-dry',
    title: seed.title ?? null,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: [
      ...missingIds.map((itemId, slotIndex) => ({
        slotIndex,
        category: 'top',
        kind: 'garment',
        itemId,
        label: null,
        missing: true,
        imageAccess: null,
      })),
      ...slots.slice(missingIds.length).map(([category, itemId], index) => ({
        slotIndex: missingIds.length + index,
        category,
        kind: 'catalog',
        itemId,
        label: null,
        missing: false,
        imageAccess: null,
      })),
    ],
    swaps: {},
    collection: 'all',
    comfort: {
      runsColdWarm: 'neutral',
      windTolerance: 'medium',
      precipPreparedness: 'medium',
    },
    availabilityStatus: missingIds.length
      ? 'missing_garment'
      : seed.needsReview
        ? 'needs_review'
        : 'ready',
    missingGarmentIds: missingIds,
    needsReviewReasons:
      seed.needsReview && !missingIds.length ? ['category_changed'] : [],
    revision: 0,
    createdAt: at,
    // Updated order is the reverse of created order, so a list read without `sort` shows a
    // different order and a page that forgot the param cannot pass an order check.
    updatedAt: minutesAfter(100_000 - seed.created),
  }
}

function capsuleContract(memberId: string, seed: CapsuleSeed) {
  const at = minutesAfter(seed.created)
  return {
    id: seed.id,
    ownerUserId: memberId,
    name: seed.name,
    description: null,
    occasions: ['work'],
    isFavorite: false,
    revision: 1,
    availabilityStatus: seed.unavailable ? 'needs_repair' : 'ready',
    unavailableGarmentCount: seed.unavailable ?? 0,
    garments: [],
    createdAt: at,
    updatedAt: minutesAfter(100_000 - seed.created),
  }
}

/** Server order for `sort=created_desc`. */
function createdDesc<T extends { id: string; createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    if (byTime !== 0) return byTime
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function updatedDesc<T extends { id: string; updatedAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byTime = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (byTime !== 0) return byTime
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

const etag = (id: string, revision: number) => `"saved-look:${id}:${revision}"`

export interface LooksFixtureOptions {
  looks?: LookSeed[]
  capsules?: CapsuleSeed[]
  /** `free` answers the planner with the Premium-required 403; `premium` keeps the shell week. */
  planner?: 'free' | 'premium'
  mode?: ShellMode
  memberId?: string
  /** A saved look read answers 503 (P1: a failed read still opens Saved). */
  failLooksRead?: boolean
}

/**
 * Opens the CC-7.7 fixture shell signed in, then answers the Looks reads from `options`.
 * Routes registered here answer before the shell router (Playwright runs the last match first).
 */
export async function openLooksFixture(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  options: LooksFixtureOptions = {}
) {
  const memberId = options.memberId ?? 'looks-fixture-member'
  const shell = await openFixtureShell(page, interceptNetworkCall, {
    mode: options.mode ?? 'populated',
    screen: 'looks',
    memberId,
  })
  const looks = new Map(
    (options.looks ?? []).map((seed) => [seed.id, lookContract(memberId, seed)])
  )
  const removed = new Map<string, ReturnType<typeof lookContract>>()
  const capsules = (options.capsules ?? []).map((seed) => capsuleContract(memberId, seed))
  /** Every list read, as `path?query`, in order. */
  const listReads: string[] = []
  const detailReads: string[] = []
  /** Reads held until the test releases them (`hold('capsules')`). */
  const gates = new Map<'saved-looks' | 'capsules', Promise<void>>()
  const waitGate = async (kind: 'saved-looks' | 'capsules') => {
    const gate = gates.get(kind)
    if (gate) await gate
  }

  const listLooks = async (route: Route, request: Request) => {
    const url = new URL(request.url())
    listReads.push(`saved-looks?${url.searchParams.toString()}`)
    await waitGate('saved-looks')
    if (options.failLooksRead) {
      return route.fulfill({
        status: 503,
        json: { statusCode: 503, message: 'Unavailable' },
      })
    }
    const source = url.searchParams.get('source')
    const sort = url.searchParams.get('sort')
    const limit = Number(url.searchParams.get('limit') ?? '50')
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const rows = [...looks.values()].filter((look) => !source || look.source === source)
    const ordered = sort === 'created_desc' ? createdDesc(rows) : updatedDesc(rows)
    const body = savedLookListResponseSchema.parse({
      data: ordered.slice(offset, offset + limit),
      total: ordered.length,
      limit,
      offset,
    })
    // A held read can outlive the page; nothing to answer then.
    return route
      .fulfill({ json: body, headers: { 'cache-control': 'private, no-store' } })
      .catch(() => undefined)
  }

  await page.route('**/api/v1/wardrobe/saved-looks**', async (route, request) => {
    const { pathname } = new URL(request.url())
    const match = /\/wardrobe\/saved-looks(?:\/([^/]+))?(\/restore)?$/.exec(pathname)
    if (!match) return route.fallback()
    const [, id, restore] = match
    const method = request.method()
    if (!id && method === 'GET') return listLooks(route, request)
    if (!id) return route.fallback()
    if (method === 'GET') {
      detailReads.push(id)
      const look = looks.get(id)
      if (!look)
        return route.fulfill({
          status: 404,
          json: { statusCode: 404, message: 'SAVED_LOOK_NOT_FOUND' },
        })
      return route.fulfill({
        json: savedLookResponseSchema.parse({ data: look }),
        headers: { etag: etag(id, look.revision), 'cache-control': 'private, no-store' },
      })
    }
    if (method === 'DELETE') {
      const look = looks.get(id)
      if (!look)
        return route.fulfill({
          status: 404,
          json: { statusCode: 404, message: 'SAVED_LOOK_NOT_FOUND' },
        })
      looks.delete(id)
      removed.set(id, { ...look, revision: look.revision + 1 })
      return route.fulfill({ status: 204, body: '' })
    }
    if (method === 'POST' && restore) {
      const look = removed.get(id)
      if (!look)
        return route.fulfill({
          status: 404,
          json: { statusCode: 404, message: 'SAVED_LOOK_NOT_FOUND' },
        })
      removed.delete(id)
      const restored = { ...look, revision: look.revision + 1 }
      looks.set(id, restored)
      return route.fulfill({
        json: savedLookResponseSchema.parse({ data: restored }),
        headers: { etag: etag(id, restored.revision) },
      })
    }
    return route.fallback()
  })

  await page.route('**/api/v1/wardrobe/*/capsules**', async (route, request) => {
    const url = new URL(request.url())
    if (request.method() !== 'GET') return route.fallback()
    // Codex 7.12 #4: the manager reads a tile's capsule on its own when its first page lacks it.
    const one = /\/capsules\/([^/]+)$/.exec(url.pathname)
    if (one) {
      const id = decodeURIComponent(one[1]!)
      detailReads.push(`capsule:${id}`)
      const capsule = capsules.find((candidate) => candidate.id === id)
      return capsule
        ? route.fulfill({ json: outfitCapsuleResponseSchema.parse({ data: capsule }) })
        : route.fulfill({
            status: 404,
            json: { statusCode: 404, message: 'CAPSULE_NOT_FOUND' },
          })
    }
    if (!/\/capsules$/.test(url.pathname)) return route.fallback()
    listReads.push(`capsules?${url.searchParams.toString()}`)
    await waitGate('capsules')
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const ordered =
      url.searchParams.get('sort') === 'created_desc'
        ? createdDesc(capsules)
        : updatedDesc(capsules)
    const body = outfitCapsuleListResponseSchema.parse({
      data: ordered.slice(offset, offset + limit),
      total: ordered.length,
      limit,
      offset,
    })
    return route.fulfill({ json: body }).catch(() => undefined)
  })

  if (options.planner === 'free') {
    await page.route('**/api/v1/commerce/premium/planner**', (route) =>
      route.fulfill({
        status: 403,
        json: { statusCode: 403, message: PREMIUM_REQUIRED_MESSAGE, error: 'Forbidden' },
      })
    )
  }

  return {
    ...shell,
    memberId,
    /** List reads the page sent, oldest first. */
    listReads: () => [...listReads],
    detailReads: () => [...detailReads],
    /** Holds every `kind` list read from now on until the returned release runs. */
    hold: (kind: 'saved-looks' | 'capsules') => {
      let release = () => undefined as void
      gates.set(
        kind,
        new Promise<void>((resolve) => {
          release = () => {
            gates.delete(kind)
            resolve()
          }
        })
      )
      return () => release()
    },
    /** Saved look ids still saved, newest first. */
    savedIds: () => createdDesc([...looks.values()]).map((look) => look.id),
  }
}
