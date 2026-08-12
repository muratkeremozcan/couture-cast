import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { fail, sleep } from 'k6'
import http from 'k6/http'
import { apiUrl, authHeaders, uniqueEmail } from '../helpers/config'
import { signUp } from '../helpers/api'
import { deleteRequest, getJson, patchJson, postJson } from '../helpers/http'

/* --------------------------------------------------------------------------
 * Story 4.3 outfit capsule capacity scenarios.
 *
 * Every request is tagged individually so a threshold breach names the endpoint
 * that caused it rather than the aggregate.
 *
 * Two modes, because latency thresholds only mean something at volume:
 *
 * - Capacity. Seed the representative 1,000-capsule / 10,000-join owner and
 *   pass `CAPSULE_PERF_USER_ID=<owner>`. Every scenario then targets that
 *   fixture and the tagged P95 thresholds are meaningful.
 * - Smoke, the default. No fixture is assumed, so each scenario provisions its
 *   own adult account. That proves routing, auth, validation, and the response
 *   contract on every capsule endpoint without depending on seed data.
 *
 * A seeded minor such as `teen-1` cannot serve as the default owner: guardian
 * consent gating rejects the location write the ritual scenario needs.
 * -------------------------------------------------------------------------- */

const EXPLICIT_CAPSULE_OWNER = __ENV.CAPSULE_PERF_USER_ID

/**
 * Resolves the capsule owner for one scenario iteration. Returns null when the
 * smoke-mode signup fails, so the caller can report and skip rather than
 * attribute an unrelated auth failure to a capsule endpoint.
 */
function resolveCapsuleOwner(): string | null {
  if (typeof EXPLICIT_CAPSULE_OWNER === 'string' && EXPLICIT_CAPSULE_OWNER.length > 0) {
    return EXPLICIT_CAPSULE_OWNER
  }

  const { status, body } = signUp(uniqueEmail('capsule-owner'), '1990-05-18')
  if (status !== 201 || !body) {
    console.warn(`[capsules] smoke owner signup failed with ${status}`)
    return null
  }

  return body.userId
}

function capsulePath(ownerUserId: string, suffix = '') {
  return apiUrl(`/api/v1/wardrobe/${ownerUserId}/capsules${suffix}`)
}

function capsuleHeaders(ownerUserId: string) {
  return authHeaders(ownerUserId, 'admin')
}

type CapsuleListBody = {
  data: { id: string; revision: number }[]
  total: number
}

export function testCapsuleReadPaths() {
  const owner = resolveCapsuleOwner()
  if (!owner) return

  describe('capsule list, detail, and filtered search', () => {
    const list = getJson<CapsuleListBody>(capsulePath(owner, '?limit=20&offset=0'), {
      headers: capsuleHeaders(owner),
      tags: { name: 'capsules/list' },
    })
    expect(list.status, 'capsule list status').to.equal(200)

    const first = list.body?.data?.[0]
    if (first) {
      const detail = getJson(capsulePath(owner, `/${first.id}`), {
        headers: capsuleHeaders(owner),
        tags: { name: 'capsules/detail' },
      })
      expect(detail.status, 'capsule detail status').to.equal(200)
    }

    // Keyword plus occasion plus favorite is the worst-case read path.
    const search = getJson<CapsuleListBody>(
      capsulePath(owner, '?q=capsule&occasion=work&isFavorite=true&limit=20&offset=0'),
      {
        headers: capsuleHeaders(owner),
        tags: { name: 'capsules/search' },
      }
    )
    expect(search.status, 'capsule search status').to.equal(200)
  })

  sleep(1)
}

/**
 * The write path needs two eligible garments, which a freshly signed-up smoke
 * owner never has. The wardrobe seed gives every teen ten ready, active
 * garments under deterministic ids, so the mutation scenario targets that
 * fixture instead. An explicit `CAPSULE_PERF_USER_ID` still wins.
 */
const SEEDED_WARDROBE_OWNER = 'teen-1'

function resolveWriteOwner(): string {
  return typeof EXPLICIT_CAPSULE_OWNER === 'string' && EXPLICIT_CAPSULE_OWNER.length > 0
    ? EXPLICIT_CAPSULE_OWNER
    : SEEDED_WARDROBE_OWNER
}

export function testCapsuleWritePaths() {
  const owner = resolveWriteOwner()

  describe('capsule create, update, favorite, and delete', () => {
    // Tagged separately: this is the garment lookup, not a capsule endpoint.
    // Tagging it `capsules/list` folded its failures into the capsule list
    // error rate and made a healthy list endpoint read as 50 percent failed.
    //
    // Garment listing signs object-storage URLs, so it returns 503 wherever
    // storage is not provisioned. That is an environment gap rather than a
    // capsule regression, so 503 is an expected status here and must not count
    // toward http_req_failed. The write path reports and returns instead.
    const garments = http.get(apiUrl('/api/v1/wardrobe/garments'), {
      headers: capsuleHeaders(owner),
      tags: { name: 'capsules/garment-lookup' },
      responseCallback: http.expectedStatuses(200, 503),
    })

    const listedGarmentIds =
      garments.status === 200
        ? (
            (JSON.parse(garments.body as string) as { data?: { id: string }[] }).data ??
            []
          )
            .slice(0, 2)
            .map((item) => item.id)
        : []

    // Fall back to the seeded ids when listing is unavailable. The wardrobe seed
    // names them deterministically, so the mutation path stays exercised even
    // where object storage is absent.
    const garmentIds =
      listedGarmentIds.length >= 2
        ? listedGarmentIds
        : owner === SEEDED_WARDROBE_OWNER
          ? [`${owner}-garment-1`, `${owner}-garment-2`]
          : []

    if (garmentIds.length < 2) {
      console.warn(
        `[capsules] skipping write path: garment lookup returned ${garments.status} ` +
          `with ${listedGarmentIds.length} eligible garments for "${owner}", and no ` +
          'seeded fallback applies. Seed at least two ready, active garments.'
      )
      return
    }

    const created = postJson<{ data: { id: string; revision: number } }>(
      capsulePath(owner),
      {
        name: `k6 capsule ${Date.now()}`,
        occasions: ['work'],
        garmentIds,
        isFavorite: false,
      },
      { headers: capsuleHeaders(owner), tags: { name: 'capsules/create' } }
    )
    expect(created.status, 'capsule create status').to.equal(201)

    const capsule = created.body?.data
    if (!capsule) {
      fail('capsule create returned no representation')
    }

    /** The strong validator the API issues; mutations require it back. */
    let etag = `"capsule:${capsule.id}:${capsule.revision}"`

    const updated = patchJson<{ data: { revision: number } }>(
      capsulePath(owner, `/${capsule.id}`),
      { name: `k6 capsule renamed ${Date.now()}` },
      {
        headers: { ...capsuleHeaders(owner), 'If-Match': etag },
        tags: { name: 'capsules/update' },
      }
    )
    expect(updated.status, 'capsule update status').to.equal(200)
    etag = `"capsule:${capsule.id}:${updated.body?.data?.revision ?? capsule.revision + 1}"`

    const favorited = patchJson<{ data: { revision: number } }>(
      capsulePath(owner, `/${capsule.id}/favorite`),
      { isFavorite: true },
      {
        headers: { ...capsuleHeaders(owner), 'If-Match': etag },
        tags: { name: 'capsules/favorite' },
      }
    )
    expect(favorited.status, 'capsule favorite status').to.equal(200)
    etag = `"capsule:${capsule.id}:${favorited.body?.data?.revision ?? 0}"`

    const deleted = deleteRequest(capsulePath(owner, `/${capsule.id}`), {
      headers: { ...capsuleHeaders(owner), 'If-Match': etag },
      tags: { name: 'capsules/delete' },
    })
    expect(deleted.status, 'capsule delete status').to.equal(204)
  })

  sleep(1)
}

export function testCapsuleColdRitual() {
  const owner = resolveCapsuleOwner()
  if (!owner) return

  // The ritual needs a resolvable location for the owner, and the wardrobe seed
  // creates garments but no SavedLocation. Provision one the same way
  // testRitualOutfits does; a repeat run against a fixture owner may conflict.
  const location = postJson<{ data: { id: string } }>(
    apiUrl('/api/v1/locations'),
    {
      label: 'Home',
      locationKey: 'chicago-il',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    },
    { headers: capsuleHeaders(owner), tags: { name: 'capsules/location-setup' } }
  )

  if (location.status !== 201 && location.status !== 409) {
    console.warn(
      `[capsules] skipping cold ritual: location setup for "${owner}" ` +
        `returned ${location.status}.`
    )
    return
  }

  describe('cold ritual generation with capsule evaluation', () => {
    /**
     * A distinct occasion per iteration defeats the cache deliberately, so this
     * measures generation rather than a Redis hit.
     */
    const occasions = ['work', 'casual', 'formal', 'sport', 'travel', 'evening']
    const occasion = occasions[Math.floor(Math.random() * occasions.length)]

    const ritual = getJson(apiUrl(`/api/v1/ritual?occasion=${occasion}`), {
      headers: capsuleHeaders(owner),
      tags: { name: 'capsules/ritual-cold' },
    })
    expect(ritual.status, 'cold ritual status').to.equal(200)
  })

  sleep(1)
}
