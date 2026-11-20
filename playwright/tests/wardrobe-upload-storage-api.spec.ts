// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Production follow-up 2026-11-19 (tester report "Upload fail"): garment bytes no longer pass
// through the API's Vercel Function, which refused bodies over about 4.5 MB. The API hands out
// a signed Supabase Storage upload URL for one object, the client puts the bytes there, and the
// API checks the stored object only at commit. These specs hold that contract against the real
// local storage server, since the server no longer sees the bytes in flight:
// - S-1: commit before any bytes are stored is refused and leaves the session open.
// - S-2: stored bytes that differ from the declaration are refused, removed and end the
//   session; a fresh allocation then takes the corrected bytes.
// - S-3: a signed URL writes only its own path, once; a rewrite is refused and commit
//   publishes the first bytes.
// - S-4: the bucket, not the API, refuses at upload time a body one byte over 10 MiB and a
//   Content-Type it does not allow. The bytes themselves are checked at commit (S-2).
// - S-5: concurrent commits yield one winning commit; a later key is refused, the winning key
//   replays. How often the server publishes is for the instrumented service tests.
// - S-6: an allocation replay never re-signs a staged key that already holds bytes.
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  createGarmentUploadUrlResponseSchema,
  garmentListResponseSchema,
  createGarmentItemResponseSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import {
  configuredStorageOrigin,
  expectSignedStorageUpload,
} from '../support/helpers/storage-upload-url'

const environment = resolveEnvironmentConfig('local')
const garmentFixturePath = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)

type Member = { userId: string; accessToken: string }
type Image = { bytes: Buffer; sha256: string; widthPx: number; heightPx: number }

async function loadImage(): Promise<Image> {
  const bytes = await readFile(garmentFixturePath)
  const { width, height } = await sharp(bytes).metadata()
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    widthPx: width,
    heightPx: height,
  }
}

const storageTest = test.extend<{ member: Member }>({
  member: async ({ apiRequest }, use, testInfo) => {
    const signup = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl: environment.apiBaseUrl,
      body: {
        email: `${buildUniqueId('wardrobe-upload-storage', testInfo)}@example.test`,
        birthdate: '1990-06-15',
      },
    })
    expect(signup.status).toBe(201)
    const { userId } = signupResponseSchema.parse(signup.body)
    const member = { userId, accessToken: localE2EAccessToken(userId) }
    try {
      await use(member)
    } finally {
      await cleanupWardrobeUserTestData(
        apiRequest,
        member.accessToken,
        member.userId,
        environment.apiBaseUrl
      )
    }
  },
})

storageTest.describe('Garment upload straight to storage', () => {
  storageTest.use({ authSessionEnabled: false })

  storageTest.beforeEach(({}, testInfo) => {
    storageTest.skip(
      isNonLocalEnvironment(testInfo),
      'Signs members in with the local E2E token and writes to the local storage server.'
    )
  })

  storageTest(
    'S-1: commit before the bytes are stored is refused, and the session stays open for them',
    async ({ apiRequest, member }) => {
      const image = await loadImage()
      const session = await allocate(apiRequest, member, image)

      const early = await commit(apiRequest, member, session)
      expect(early.status).toBe(409)
      expect(JSON.stringify(early.body)).toContain('UPLOAD_BYTES_MISSING')

      const put = await putBytes(session.uploadUrl, image.bytes)
      expect(put.status).toBe(200)
      const committed = await commit(apiRequest, member, session)
      expect(committed.status).toBe(201)
      expect(createGarmentItemResponseSchema.parse(committed.body).data.id).toBe(
        session.garmentId
      )
      // Commit published the verified bytes to the member's garment key and removed the staged
      // upload. The final key is read from storage directly, independent of the read URL the API
      // signs: the same bytes, the verified type, and a private cache policy.
      expect(await objectStatus(objectPathOf(session.uploadUrl))).toBe('missing')
      expect(
        await storedObject(
          `wardrobe-images/wardrobe/${member.userId}/${session.garmentId}.png`
        )
      ).toEqual({
        sha256: image.sha256,
        contentType: 'image/png',
        cacheControl: 'private, max-age=0',
      })
    }
  )

  storageTest(
    'S-2: stored bytes that differ from the declaration are refused, removed and end the session; a fresh allocation takes the right ones',
    async ({ apiRequest, member }) => {
      const image = await loadImage()
      const session = await allocate(apiRequest, member, image)
      // Same length and type, one byte changed: only the checksum can tell.
      const tampered = Buffer.from(image.bytes)
      tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff

      expect((await putBytes(session.uploadUrl, tampered)).status).toBe(200)
      expect(await objectStatus(objectPathOf(session.uploadUrl))).toBe('present')
      const refused = await commit(apiRequest, member, session)
      expect(refused.status).toBe(422)
      expect(JSON.stringify(refused.body)).toContain('IMAGE_CHECKSUM_MISMATCH')

      // The refused object is gone from storage, and the session is over.
      expect(await objectStatus(objectPathOf(session.uploadUrl))).toBe('missing')
      const ended = await commit(apiRequest, member, session)
      expect(ended.status).toBe(409)
      expect(JSON.stringify(ended.body)).toContain('UPLOAD_SESSION_EXPIRED')

      // Recovery is a fresh allocation with its own staging key.
      // A new signature alone would change the URL, so the session and its key must change too.
      const retry = await allocate(apiRequest, member, image)
      expect(retry.uploadSessionId).not.toBe(session.uploadSessionId)
      expect(objectPathOf(retry.uploadUrl)).not.toBe(objectPathOf(session.uploadUrl))
      expect((await putBytes(retry.uploadUrl, image.bytes)).status).toBe(200)
      expect((await commit(apiRequest, member, retry)).status).toBe(201)
    }
  )

  storageTest(
    'S-3: a signed URL writes only its own path, once; a rewrite is refused and commit publishes the first bytes',
    async ({ apiRequest, member }) => {
      const image = await loadImage()
      const session = await allocate(apiRequest, member, image)
      const signed = new URL(session.uploadUrl)

      // Another object beside this one (same folder, same extension), with this URL's token.
      // Only the object's own name changes, whatever key format the API signs.
      const sibling = new URL(signed)
      const segments = signed.pathname.split('/')
      const fileName = segments.pop()!
      sibling.pathname = [...segments, fileName.replace(/^[^.]+/, randomUUID())].join('/')
      expect(sibling.pathname).not.toBe(signed.pathname)
      const elsewhere = await putBytes(sibling.toString(), image.bytes)
      // The token signs this URL's path only.
      expect(elsewhere.status).toBe(400)
      expect(elsewhere.body).toMatchObject({ error: 'InvalidSignature' })

      // The first write is final: a staged upload may sit under legal hold, so the staging key
      // takes no overwrite, and swapped bytes cannot replace what was uploaded.
      expect((await putBytes(session.uploadUrl, image.bytes)).status).toBe(200)
      const swapped = Buffer.from(image.bytes)
      swapped[swapped.length - 1] = swapped[swapped.length - 1]! ^ 0xff
      const rewrite = await putBytes(session.uploadUrl, swapped)
      expect(rewrite.status).toBe(400)
      expect(rewrite.body).toMatchObject({ error: 'Duplicate' })

      // Commit publishes the first bytes.
      expect((await commit(apiRequest, member, session)).status).toBe(201)
      expect(
        (
          await storedObject(
            `wardrobe-images/wardrobe/${member.userId}/${session.garmentId}.png`
          )
        ).sha256
      ).toBe(image.sha256)
    }
  )

  storageTest(
    'S-4: the bucket refuses a body one byte over 10 MiB and a disallowed Content-Type',
    async ({ apiRequest, member }) => {
      const image = await loadImage()
      const session = await allocate(apiRequest, member, image)

      const oversized = await putBytes(
        session.uploadUrl,
        Buffer.concat([
          image.bytes,
          Buffer.alloc(10 * 1024 * 1024 + 1 - image.bytes.length),
        ])
      )
      expect(oversized.status).toBe(400)
      expect(oversized.body).toMatchObject({
        error: 'Payload too large',
        statusCode: '413',
      })

      // Valid PNG bytes under a Content-Type the bucket does not allow.
      const notAnImage = await putBytes(session.uploadUrl, image.bytes, 'text/html')
      expect(notAnImage.status).toBe(400)
      expect(notAnImage.body).toMatchObject({
        error: 'invalid_mime_type',
        statusCode: '415',
      })

      // Neither refusal stored anything, so the right bytes still go in once.
      expect((await putBytes(session.uploadUrl, image.bytes)).status).toBe(200)
      expect((await commit(apiRequest, member, session)).status).toBe(201)
    }
  )

  storageTest(
    'S-5: concurrent commits yield one winning commit; a later key is refused and the winning key replays',
    async ({ apiRequest, member }) => {
      const image = await loadImage()
      const session = await allocate(apiRequest, member, image)
      expect((await putBytes(session.uploadUrl, image.bytes)).status).toBe(200)

      // Two commits under different keys race. Which one wins, and whether the loser arrives
      // while the winner still publishes (UPLOAD_IN_PROGRESS) or after it finished
      // (IDEMPOTENCY_KEY_REUSED), is the server's timing; the forced orders are unit-tested in
      // wardrobe.service specs. Either way exactly one commit lands.
      const keys = [randomUUID(), randomUUID()] as const
      const raced = await Promise.all(
        keys.map((key) => commit(apiRequest, member, session, key))
      )
      const winners = raced.filter((result) => result.status === 201)
      const losers = raced.filter((result) => result.status !== 201)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      expect(losers[0]!.status).toBe(409)
      expect(['UPLOAD_IN_PROGRESS', 'IDEMPOTENCY_KEY_REUSED']).toContain(
        (losers[0]!.body as { message?: string }).message
      )
      const winningKey = keys[raced.indexOf(winners[0]!)]!

      // After the winner finished the outcome is fixed.
      const later = await commit(apiRequest, member, session)
      expect(later.status).toBe(409)
      expect(later.body).toMatchObject({ message: 'IDEMPOTENCY_KEY_REUSED' })
      const replay = await commit(apiRequest, member, session, winningKey)
      expect(replay.status).toBe(200)
      // The replay answers for the same committed garment as it stands now: its identity and
      // stage are checked, not the whole body, since the worker moves status on and every read
      // URL is signed afresh. Each answer's read URL is checked on its own.
      const [won, replayed] = [winners[0]!, replay].map(
        (answer) => createGarmentItemResponseSchema.parse(answer.body).data
      ) as [GarmentAnswer, GarmentAnswer]
      for (const garment of [won, replayed]) {
        expect(garment.id).toBe(session.garmentId)
        expect(['processing', 'awaiting_tags', 'ready']).toContain(garment.status)
        expect(garment.mimeType).toBe('image/png')
        expect(garment.fileSizeBytes).toBe(image.bytes.byteLength)
        expectGarmentReadUrl(garment.imageAccess?.url, member.userId, session.garmentId)
      }
      // The commit happened once, and its time does not move on replay.
      expect(won.committedAt).not.toBeNull()
      expect(replayed.committedAt).toBe(won.committedAt)

      // One garment row, holding the uploaded bytes.
      const listed = await apiRequest({
        method: 'GET',
        path: '/api/v1/wardrobe/garments',
        baseUrl: environment.apiBaseUrl,
        headers: { Authorization: `Bearer ${member.accessToken}` },
      })
      expect(
        garmentListResponseSchema.parse(listed.body).data.map(({ id }) => id)
      ).toEqual([session.garmentId])
      expect(
        (
          await storedObject(
            `wardrobe-images/wardrobe/${member.userId}/${session.garmentId}.png`
          )
        ).sha256
      ).toBe(image.sha256)
    }
  )

  storageTest(
    'S-6: replaying an allocation whose staged key already holds bytes is refused',
    async ({ apiRequest, member }) => {
      const image = await loadImage()
      const key = randomUUID()
      const session = await allocate(apiRequest, member, image, key)
      expect((await putBytes(session.uploadUrl, image.bytes)).status).toBe(200)

      // Signing the occupied key again would hand out a URL that can only meet Duplicate, so the
      // API says the bytes are there; the client then starts a fresh attempt.
      const replay = await apiRequest({
        method: 'POST',
        path: '/api/v1/wardrobe/upload-url',
        baseUrl: environment.apiBaseUrl,
        headers: {
          Authorization: `Bearer ${member.accessToken}`,
          'Idempotency-Key': key,
        },
        body: {
          fileSizeBytes: image.bytes.byteLength,
          mimeType: 'image/png',
          sha256: image.sha256,
          widthPx: image.widthPx,
          heightPx: image.heightPx,
        },
      })
      expect(replay.status).toBe(409)
      expect(replay.body).toMatchObject({ message: 'UPLOAD_BYTES_PRESENT' })

      // The session itself is untouched and commits the stored bytes.
      expect((await commit(apiRequest, member, session)).status).toBe(201)
    }
  )
})

type ApiRequest = Parameters<Parameters<typeof storageTest>[2]>[0]['apiRequest']
type Session = { garmentId: string; uploadSessionId: string; uploadUrl: string }

async function allocate(
  apiRequest: ApiRequest,
  member: Member,
  image: Image,
  idempotencyKey: string = randomUUID()
): Promise<Session> {
  const response = await apiRequest({
    method: 'POST',
    path: '/api/v1/wardrobe/upload-url',
    baseUrl: environment.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${member.accessToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: {
      fileSizeBytes: image.bytes.byteLength,
      mimeType: 'image/png',
      sha256: image.sha256,
      widthPx: image.widthPx,
      heightPx: image.heightPx,
    },
  })
  expect(response.status).toBe(201)
  const { garmentId, uploadSessionId, uploadUrl } =
    createGarmentUploadUrlResponseSchema.parse(response.body).data
  // The bytes go to storage, never through the API, at the session's staging key; commit
  // publishes the verified bytes to the garment's final key.
  expect(expectSignedStorageUpload(uploadUrl).pathname).toMatch(
    new RegExp(
      `/wardrobe-images/staging/${member.userId}/garment/${uploadSessionId}\\.png$`
    )
  )
  return { garmentId, uploadSessionId, uploadUrl }
}

/**
 * A signed upload must work for anyone holding the URL and nothing else, so these PUTs go
 * through a bare fetch: no Playwright request fixture, whose context can carry the run's
 * credentials, and no Authorization header. The host is checked before any byte leaves.
 * Returns the status and the parsed JSON body (storage answers JSON on every path here).
 */
async function putBytes(
  uploadUrl: string,
  bytes: Buffer,
  contentType = 'image/png'
): Promise<{ status: number; body: unknown }> {
  expect(new URL(uploadUrl).origin, 'storage origin').toBe(configuredStorageOrigin())
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(bytes),
    // A redirect could carry the bytes to a host the check above never saw.
    redirect: 'error',
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // Not JSON: keep the text for the failure message.
  }
  return { status: response.status, body }
}

function commit(
  apiRequest: ApiRequest,
  member: Member,
  session: Session,
  idempotencyKey: string = randomUUID()
) {
  return apiRequest({
    method: 'POST',
    path: '/api/v1/wardrobe/garments',
    baseUrl: environment.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${member.accessToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: {
      garmentId: session.garmentId,
      uploadSessionId: session.uploadSessionId,
      hasCropping: false,
      hasBgCleanup: false,
    },
  })
}

type GarmentAnswer = ReturnType<typeof createGarmentItemResponseSchema.parse>['data']

/** A garment read URL: signed, on the configured storage host, for this garment's final key. */
function expectGarmentReadUrl(
  url: string | undefined,
  userId: string,
  garmentId: string
): void {
  expect(url, 'garment read URL').toBeDefined()
  const read = new URL(url!)
  expect(read.origin, 'storage origin').toBe(configuredStorageOrigin())
  expect(read.pathname).toBe(
    `/storage/v1/object/sign/wardrobe-images/wardrobe/${userId}/${garmentId}.png`
  )
  expect(read.searchParams.get('token')).toBeTruthy()
}

/** The bucket path a signed upload URL names, e.g. `wardrobe-images/staging/<user>/garment/<id>.png`. */
function objectPathOf(uploadUrl: string): string {
  return expectSignedStorageUpload(uploadUrl).pathname.replace(
    /^\/storage\/v1\/object\/upload\/sign\//,
    ''
  )
}

/**
 * Reads storage with the stack's service role. Verification only: it targets the configured
 * storage host, sends no signed query and refuses redirects. The uploads never carry it (see
 * putBytes).
 */
function serviceRoleRead(route: string): Promise<Response> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!serviceRoleKey)
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for this check.')
  return fetch(`${configuredStorageOrigin()}/storage/v1/object/${route}`, {
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
    redirect: 'error',
  })
}

/** Whether an object exists; any answer but the object-not-found error fails the test. */
async function objectStatus(bucketPath: string): Promise<'present' | 'missing'> {
  const response = await serviceRoleRead(`info/authenticated/${bucketPath}`)
  if (response.ok) return 'present'
  // A missing bucket also says 404, with error "Bucket not found"; only this means no object.
  expect(await response.json(), `storage answer ${response.status}`).toMatchObject({
    statusCode: '404',
    error: 'not_found',
  })
  return 'missing'
}

/** A stored object's bytes (as SHA-256) and the headers storage serves it with. */
async function storedObject(
  bucketPath: string
): Promise<{ sha256: string; contentType: string | null; cacheControl: string | null }> {
  const response = await serviceRoleRead(`authenticated/${bucketPath}`)
  expect(response.status, `download ${bucketPath}`).toBe(200)
  return {
    sha256: createHash('sha256')
      .update(Buffer.from(await response.arrayBuffer()))
      .digest('hex'),
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
  }
}
