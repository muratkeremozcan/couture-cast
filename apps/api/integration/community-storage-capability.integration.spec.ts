// Story 6.11 R8-1: the community storage adapter against real local Supabase Storage and a real migrated Postgres.
// It runs only when COMMUNITY_REAL_STORAGE_TEST is true, in the CI job that starts local Supabase.
//
// Storage fixes a signed upload token's lifetime per deployment, and this suite cannot wait 2 hours.
// So the expiry cases re-sign a token storage really minted, changing only its times, with the local signing secret.
// A control re-signs with a future expiry and must succeed, so a refusal can only come from the expiry.
// Sweeps take an injected clock, so 6 hours and 73 hours pass without a real wait.
//
// Exercised for real: storage's expiry check, overwrite, path binding, the 2 hour mint, the processor and the sweeps.
// Not exercised: hosted Supabase and its gateway, and a request stalled past expiry, which the test design records from a probe.
import 'reflect-metadata'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { ServiceUnavailableException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
  ERASURE_DEADLINE_HOURS,
} from '../src/modules/community/community-maintenance.service.js'
import { FixtureCommunityModerationEngine } from '../src/modules/community/community-moderation.engine.js'
import { CommunityModerationProcessor } from '../src/modules/community/community-moderation.processor.js'
import {
  COMMUNITY_IMAGES_BUCKET,
  COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS,
  SupabaseCommunityStorageAdapter,
  type CommunityOverwriteCapability,
} from '../src/modules/community/community-storage.adapter.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

const LOCAL_SIGNING_SECRET =
  process.env.SUPABASE_LOCAL_JWT_SECRET ??
  'super-secret-jwt-token-with-at-least-32-characters-long'
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
const later = (at: Date, ms: number) => new Date(at.getTime() + ms)
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

const claimsOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    url: string
    upsert?: boolean
    iat: number
    exp: number
  }

/** The token storage minted, with its times changed and nothing else. */
function resign(token: string, expiresInSeconds: number, url?: string) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const body = encode({
    ...claimsOf(token),
    ...(url ? { url } : {}),
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
  })
  const signature = createHmac('sha256', LOCAL_SIGNING_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

function gated() {
  let enter!: () => void
  let open!: () => void
  const inside = new Promise<void>((done) => {
    enter = done
  })
  const gate = new Promise<void>((done) => {
    open = done
  })
  return { inside, gate, enter, open }
}

/** The real adapter with a hook where a worker can pause, and where it can lose the response. */
class PausableStorage extends SupabaseCommunityStorageAdapter {
  hold: ReturnType<typeof gated> | null = null
  shortLifetimeSeconds: number | null = null
  loseResponse = false
  removeRefused = false
  capability: CommunityOverwriteCapability | null = null

  override async createOverwriteCapability(objectPath: string) {
    const real = await super.createOverwriteCapability(objectPath)
    this.capability =
      this.shortLifetimeSeconds === null
        ? real
        : {
            ...real,
            token: resign(real.token, this.shortLifetimeSeconds),
            expiresAt: later(new Date(), this.shortLifetimeSeconds * 1000),
          }
    return this.capability
  }

  override async upload(
    objectPath: string,
    bytes: Buffer,
    mimeType: string,
    capability: CommunityOverwriteCapability
  ) {
    if (this.hold) {
      this.hold.enter()
      await this.hold.gate
    }
    await super.upload(objectPath, bytes, mimeType, capability)
    if (this.loseResponse) throw new Error('worker lost')
  }

  override remove(objectPaths: string[]) {
    return this.removeRefused
      ? Promise.reject(new Error('storage down'))
      : super.remove(objectPaths)
  }
}

describe.runIf(process.env.COMMUNITY_REAL_STORAGE_TEST === 'true')(
  'R8-1: real Supabase Storage refuses a late write',
  () => {
    const database = isolatedCommunityDatabase()
    let prisma: PrismaClient
    const url = process.env.SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    const admin = () =>
      createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      }).storage.from(COMMUNITY_IMAGES_BUCKET)
    const created: string[] = []
    const newPath = () => {
      const path = `community/tea-r8-${randomUUID()}/image.jpg`
      created.push(path)
      return path
    }
    const put = async (path: string, bytes: Buffer) => {
      const { error } = await admin().upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      })
      expect(error).toBeNull()
    }
    const stored = async (path: string) => {
      const response = await fetch(
        `${url}/storage/v1/object/${COMMUNITY_IMAGES_BUCKET}/${path}`,
        { headers: { authorization: `Bearer ${key}`, apikey: key } }
      )
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      const body = (await response.json()) as { statusCode?: string }
      expect(body.statusCode, JSON.stringify(body)).toBe('404')
      return null
    }
    const jpeg = () =>
      sharp({ create: { width: 512, height: 640, channels: 3, background: '#112233' } })
        .jpeg({ quality: 100 })
        .toBuffer()
    const telemetry = {
      captureEvent: () => Promise.resolve(),
    } as unknown as TelemetryService
    const processorWith = (storage: PausableStorage) =>
      new CommunityModerationProcessor(
        prisma,
        storage,
        telemetry,
        new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [] },
        }),
        undefined,
        { getFeatureFlag: () => Promise.resolve(true) }
      )
    const eraser = (storage: PausableStorage) =>
      new CommunityMaintenanceService(prisma, storage)
    const job = (post: { id: string }) => ({ postId: post.id, uploadSessionId: post.id })

    async function pendingPost() {
      const user = await persistUser(prisma, createUser())
      const bytes = await jpeg()
      const path = newPath()
      await put(path, bytes)
      const post = await prisma.lookbookPost.create({
        data: {
          ...buildLookbookPostCreateInput(
            createLookbookPost({ userId: user.id, status: 'pending_review' })
          ),
          image_object_path: path,
          image_checksum: createHash('sha256').update(bytes).digest('hex'),
          image_byte_size: bytes.length,
          image_content_type: 'image/jpeg',
        },
      })
      await prisma.communityModerationOutbox.create({ data: { post_id: post.id } })
      return { user, post, path }
    }

    /** A draft the way allocation leaves it: a real client token and the 15 minute client expiry. */
    async function draftWithClientToken() {
      const user = await persistUser(prisma, createUser())
      const bytes = await jpeg()
      const path = newPath()
      const session = await new SupabaseCommunityStorageAdapter().createUploadSession(
        path
      )
      const post = await prisma.lookbookPost.create({
        data: {
          ...buildLookbookPostCreateInput(
            createLookbookPost({ userId: user.id, status: 'draft' })
          ),
          published_at: null,
          image_object_path: path,
          image_checksum: createHash('sha256').update(bytes).digest('hex'),
          image_byte_size: bytes.length,
          image_content_type: 'image/jpeg',
          upload_expires_at: new Date(session.expiresAt),
        },
      })
      const clientWrite = async () => {
        const response = await fetch(session.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: new Uint8Array(bytes),
        })
        return response.status
      }
      return { user, post, path, session, clientWrite }
    }

    const overdueAt = (requestedAt: Date) =>
      later(requestedAt, (ERASURE_DEADLINE_HOURS + 1) * HOUR_MS)

    beforeAll(async () => {
      const host = new URL(url).hostname
      if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(
          `Refusing to run against ${host}: this suite signs its own tokens`
        )
      }
      await database.migrate()
      prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
      await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
    }, 60_000)

    afterAll(async () => {
      if (created.length) await admin().remove(created)
      await prisma?.$disconnect()
      await database.drop()
    })

    describe('what storage itself enforces', () => {
      const adapter = () => new SupabaseCommunityStorageAdapter()

      it('mints the 2 hour token the numbers are built on, inside the erasure window', async () => {
        const capability = await adapter().createOverwriteCapability(newPath())
        const claims = claimsOf(capability.token)
        expect((claims.exp - claims.iat) * 1000).toBe(COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS)
        expect(capability.expiresAt.getTime()).toBe(claims.exp * 1000)
        expect(claims.upsert).toBe(true)
        expect(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS).toBeGreaterThan(
          COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS
        )
      })

      it('overwrites through the token, and a delete does not spend it', async () => {
        const path = newPath()
        await put(path, Buffer.from('original'))
        const capability = await adapter().createOverwriteCapability(path)
        const next = Buffer.from('normalized')
        await adapter().upload(path, next, 'image/jpeg', capability)
        expect(await stored(path)).toEqual(next)

        await adapter().remove([path])
        expect(await stored(path)).toBeNull()
        await adapter().upload(path, next, 'image/jpeg', capability)
        expect(await stored(path), 'why the final delete must wait').toEqual(next)
      })

      it('refuses an expired token, while the same token with a future expiry passes', async () => {
        const path = newPath()
        const real = await adapter().createOverwriteCapability(path)
        const bytes = Buffer.from('late')
        await expect(
          adapter().upload(path, bytes, 'image/jpeg', {
            ...real,
            token: resign(real.token, -1),
          })
        ).rejects.toBeInstanceOf(ServiceUnavailableException)
        expect(await stored(path)).toBeNull()

        await adapter().upload(path, bytes, 'image/jpeg', {
          ...real,
          token: resign(real.token, 60),
        })
        expect(await stored(path)).toEqual(bytes)
      })

      it('binds the token to its one object', async () => {
        const path = newPath()
        const other = newPath()
        const real = await adapter().createOverwriteCapability(path)
        await expect(
          adapter().upload(other, Buffer.from('x'), 'image/jpeg', real)
        ).rejects.toBeInstanceOf(ServiceUnavailableException)
        expect(await stored(other)).toBeNull()
      })
    })

    describe('reservation, final delete, late upload, lost response, 73 hour sweep', () => {
      it('storage refuses a worker that resumes after the final delete', async () => {
        const { user, post, path } = await pendingPost()
        const storage = new PausableStorage()
        storage.shortLifetimeSeconds = 2
        const hold = gated()
        storage.hold = hold
        const lost = processorWith(storage).process(job(post))
        const settled = lost.then(
          () => 'resolved',
          (error: unknown) => error
        )
        await hold.inside

        const requestedAt = new Date()
        await new CommunityRepository(prisma).requestErasureForUser(user.id, requestedAt)
        await eraser(storage).sweepErasureRequests(requestedAt)
        expect(await stored(path)).toBeNull()
        const finalAt = later(requestedAt, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + 1)
        await eraser(storage).sweepErasureRequests(finalAt)
        // Story 6.13: once the objects are gone, completing the erasure deletes the post row too.
        expect(
          await prisma.lookbookPost.findUnique({ where: { id: post.id } })
        ).toBeNull()

        // Source that mints no token has nothing to wait for, and fails below on the late write.
        const expiry = storage.capability?.expiresAt.getTime() ?? 0
        await sleep(Math.max(0, expiry - Date.now()) + 1100)
        hold.open()
        expect(await settled, 'storage must refuse the late upload').toBeInstanceOf(
          ServiceUnavailableException
        )
        expect(await stored(path), 'the late upload recreated the object').toBeNull()

        storage.hold = null
        await processorWith(storage)
          .process(job(post))
          .catch(() => undefined)
        expect(await stored(path), 'a retry has no ownership').toBeNull()

        expect(
          await eraser(storage).sweepErasureRequests(overdueAt(requestedAt))
        ).toMatchObject({ hidden: 0, anonymized: 0, objectsPurged: 0, overdue: 0 })
        expect(await stored(path)).toBeNull()
      }, 30_000)

      it('a write that lands before the token expires is gone after the final delete', async () => {
        const { user, post, path } = await pendingPost()
        const storage = new PausableStorage()
        const hold = gated()
        storage.hold = hold
        storage.loseResponse = true
        const lost = processorWith(storage).process(job(post))
        const settled = lost.then(
          () => 'resolved',
          (error: unknown) => error
        )
        await hold.inside

        const requestedAt = new Date()
        await new CommunityRepository(prisma).requestErasureForUser(user.id, requestedAt)
        await eraser(storage).sweepErasureRequests(requestedAt)
        hold.open()
        expect(await settled).toMatchObject({ message: 'worker lost' })
        expect(await stored(path), 'the token was still good').not.toBeNull()

        storage.hold = null
        storage.loseResponse = false
        await eraser(storage).sweepErasureRequests(
          later(requestedAt, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + 1)
        )
        expect(await stored(path)).toBeNull()
        expect(
          await eraser(storage).sweepErasureRequests(overdueAt(requestedAt))
        ).toMatchObject({ objectsPurged: 0, overdue: 0 })
      }, 30_000)

      it('reports overdue only while the object is really still there', async () => {
        const { user, post, path } = await pendingPost()
        const storage = new PausableStorage()
        const requestedAt = new Date()
        await new CommunityRepository(prisma).requestErasureForUser(user.id, requestedAt)
        storage.removeRefused = true
        const at = overdueAt(requestedAt)
        expect(await eraser(storage).sweepErasureRequests(at)).toMatchObject({
          objectsPurged: 0,
          overdue: 1,
        })
        expect(await stored(path)).not.toBeNull()
        const open = await prisma.lookbookPost.findUniqueOrThrow({
          where: { id: post.id },
        })
        expect(open.objects_purged_at).toBeNull()

        storage.removeRefused = false
        expect(
          await eraser(storage).sweepErasureRequests(later(at, 16 * MINUTE_MS))
        ).toMatchObject({ overdue: 0 })
        expect(await stored(path)).toBeNull()
      }, 30_000)
    })

    describe('a client token outlives the 15 minute client expiry', () => {
      it('a client upload past the old 15 minute sweep point, then erasure, ends with the object gone', async () => {
        const { user, post, path, session, clientWrite } = await draftWithClientToken()
        expect(new Date(session.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
          15 * MINUTE_MS
        )
        const storage = new PausableStorage()
        const pastClientExpiry = later(new Date(session.expiresAt), MINUTE_MS)
        expect(await eraser(storage).sweepExpiredUploads(pastClientExpiry)).toMatchObject(
          {
            draftsDeleted: 0,
          }
        )
        expect(
          await prisma.lookbookPost.findUnique({ where: { id: post.id } }),
          'the row erasure needs is gone'
        ).not.toBeNull()

        expect(await clientWrite()).toBe(200)
        expect(await stored(path)).not.toBeNull()

        const requestedAt = pastClientExpiry
        await new CommunityRepository(prisma).requestErasureForUser(user.id, requestedAt)
        await eraser(storage).sweepErasureRequests(requestedAt)
        expect(await stored(path)).toBeNull()

        expect(await clientWrite(), 'the client token still works').toBe(200)
        await eraser(storage).sweepErasureRequests(
          later(requestedAt, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + 1)
        )
        expect(await stored(path)).toBeNull()
        expect(
          await eraser(storage).sweepErasureRequests(overdueAt(requestedAt))
        ).toMatchObject({ objectsPurged: 0, overdue: 0 })
      }, 30_000)

      it('a replay renewal keeps the row for the token it mints, and refuses once erasure is requested', async () => {
        const { user, post, path, session, clientWrite } = await draftWithClientToken()
        const repository = new CommunityRepository(prisma)
        const storage = new PausableStorage()
        const renewedAt = later(
          new Date(session.expiresAt),
          COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + MINUTE_MS
        )
        expect(
          await repository.confirmAllocationReplay(
            post.id,
            later(renewedAt, 15 * MINUTE_MS)
          )
        ).toBe(true)
        expect(await eraser(storage).sweepExpiredUploads(renewedAt)).toMatchObject({
          draftsDeleted: 0,
        })
        expect(await clientWrite()).toBe(200)

        await repository.requestErasureForUser(user.id, renewedAt)
        expect(
          await repository.confirmAllocationReplay(post.id, later(renewedAt, HOUR_MS))
        ).toBe(false)
        await eraser(storage).sweepErasureRequests(
          later(renewedAt, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + 1)
        )
        expect(await stored(path)).toBeNull()
      }, 30_000)

      it('with no erasure, the sweep removes the draft and its object once the token is dead', async () => {
        const { post, path, session, clientWrite } = await draftWithClientToken()
        expect(await clientWrite()).toBe(200)
        const storage = new PausableStorage()
        const past = later(
          new Date(session.expiresAt),
          COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + MINUTE_MS
        )
        expect(await eraser(storage).sweepExpiredUploads(past)).toMatchObject({
          draftsDeleted: 1,
        })
        expect(
          await prisma.lookbookPost.findUnique({ where: { id: post.id } })
        ).toBeNull()
        expect(await stored(path)).toBeNull()
      }, 30_000)
    })
  }
)
