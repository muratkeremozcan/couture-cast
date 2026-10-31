// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient, type Prisma, type CommunityPostStatus } from '@prisma/client'
import request from 'supertest'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeShareCardBase64 } from '@couture/api-client'
import { prepareShareCardResponseSchema } from '@couture/api-client/contracts/http'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { listenHttpApp, listenHttpHandler } from '../src/testing/loopback-http-app.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { SupabaseCommunityStorageAdapter } from '../src/modules/community/community-storage.adapter.js'
import { ShareCardSourceRepository } from '../src/modules/share-cards/share-card-source.repository.js'
import { ShareCardRenderer } from '../src/modules/share-cards/share-card-renderer.js'
import { ShareCardsService } from '../src/modules/share-cards/share-cards.service.js'
import { ShareCardsController } from '../src/modules/share-cards/share-cards.controller.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const flags = {
  communityReadEvaluation: vi.fn(() =>
    Promise.resolve({
      value: true,
      expiresAt: new Date('2099-01-01'),
      validUntil: Number.MAX_SAFE_INTEGER,
    })
  ),
}
const repository = new CommunityRepository(prisma)
const storage = new SupabaseCommunityStorageAdapter()
const community = new CommunityService(
  repository,
  flags as never,
  {} as never,
  {} as never,
  storage,
  {} as never
)
const sources = new ShareCardSourceRepository(prisma, community)
const renderer = new ShareCardRenderer()
const service = new ShareCardsService(prisma, sources, renderer, storage)
const objects = new Map<string, Buffer>()
const delivery = new Map<string, 'slow' | 'oversized'>()
const cutShort = new Set<string>()
let reads = 0
let app: INestApplication
let url: string
let storageServer: Awaited<ReturnType<typeof listenHttpHandler>>
let member: string
let other: string
let photo: Buffer
const preview = (source: Record<string, string>) => ({
  source,
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
})
const post = (body: object | string, actor = member) =>
  request(url)
    .post('/api/v1/share-cards/prepare')
    .set('Authorization', `Bearer ${actor}`)
    .send(body)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
/** Fifteen years before the live clock the age rule reads, so the member stays a teen. */
function teenBirthdate() {
  const birthdate = new Date()
  birthdate.setUTCFullYear(birthdate.getUTCFullYear() - 15)
  return birthdate
}
async function user(birthdate = new Date('1990-01-01')) {
  return (
    await prisma.user.create({
      data: {
        email: `${randomUUID()}@cc68.test`,
        profile: {
          create: { birthdate, preferences: { compliance: { accountStatus: 'active' } } },
        },
      },
    })
  ).id
}
async function outfit(
  actor = member,
  garmentIds: string[] = ['default-top', 'default-bottom']
) {
  return prisma.outfitRecommendation.create({
    data: { user_id: actor, scenario: 'morning', garment_ids: garmentIds },
  })
}
async function photoPost(status: CommunityPostStatus = 'published', actor = member) {
  const id = `cc68-${randomUUID()}`
  const path = `community/${id}/${randomUUID()}.png`
  objects.set(`/storage/v1/object/authenticated/community-images/${path}`, photo)
  return prisma.lookbookPost.create({
    data: {
      id,
      user_id: actor,
      status,
      published_at: status === 'published' ? new Date() : null,
      submitted_at: new Date(),
      alt_text: 'Private original filename https://private.invalid',
      alt_text_confirmed_at: new Date(),
      caption: 'Private NAME GPS and https://private.invalid',
      image_object_path: path,
      image_checksum: digest(photo),
      image_byte_size: photo.length,
      image_content_type: 'image/png',
    },
  })
}
beforeAll(async () => {
  await database.migrate()
  await prisma.$queryRaw`SELECT 1 FROM "CommunitySubject" LIMIT 1`
  photo = await sharp({
    create: { width: 600, height: 900, channels: 3, background: '#24688a' },
  })
    .withMetadata({
      exif: { IFD0: { Artist: 'GPS NAME https://private.invalid/name.png' } },
    })
    .png()
    .toBuffer()
  storageServer = await listenHttpHandler((req, res) => {
    reads++
    const bytes = objects.get(req.url ?? '')
    if (!bytes) {
      res.writeHead(404)
      res.end()
      return
    }
    if (delivery.get(req.url ?? '') === 'oversized') {
      res.writeHead(200)
      res.end(Buffer.alloc(10 * 1024 * 1024 + 1))
      return
    }
    if (delivery.get(req.url ?? '') === 'slow') {
      res.writeHead(200)
      res.write(bytes.subarray(0, 1))
      const timeout = setTimeout(() => res.end(bytes.subarray(1)), 7000)
      res.once('close', () => {
        clearTimeout(timeout)
        if (!res.writableFinished) cutShort.add(req.url ?? '')
      })
      return
    }
    res.writeHead(200, { 'Content-Length': bytes.length })
    res.end(bytes)
  })
  vi.stubEnv('SUPABASE_URL', storageServer.url)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'cc68-local-storage-fixture')
  const module = await Test.createTestingModule({
    controllers: [ShareCardsController],
    providers: [
      { provide: ShareCardsService, useValue: service },
      {
        provide: AccessTokenIdentityService,
        useValue: {
          resolveIdentity: (token: string) =>
            Promise.resolve({ userId: token, role: 'adult' }),
        },
      },
      {
        provide: GuardianConsentStateService,
        useValue: { canTeenAccess: () => Promise.resolve(true) },
      },
    ],
  }).compile()
  app = module.createNestApplication()
  app.useLogger(false)
  url = await listenHttpApp(app)
}, 60000)
beforeEach(async () => {
  flags.communityReadEvaluation.mockResolvedValue({
    value: true,
    expiresAt: new Date('2099-01-01'),
    validUntil: Number.MAX_SAFE_INTEGER,
  })
  member = await user()
  other = await user()
  reads = 0
})
afterAll(async () => {
  await app?.close()
  await storageServer?.close()
  await prisma.$disconnect()
  await database.drop()
  vi.unstubAllEnvs()
})

describe('share-card actual API and isolated database', () => {
  it('I-OUTFIT I-DETERMINISTIC I-AUDIT: original PNG response, fresh save authorization and closed audit', async () => {
    const row = await outfit()
    const input = preview({ kind: 'outfit', recommendationId: row.id })
    const first = await post(input).expect(200)
    expect(first.headers['cache-control']).toBe('private, no-store')
    const card = prepareShareCardResponseSchema.parse(first.body).data
    const bytes = decodeShareCardBase64(card.pngBase64)
    expect(digest(Buffer.from(bytes))).toBe(card.sha256)
    const again = prepareShareCardResponseSchema.parse(
      (await post(input).expect(200)).body
    ).data
    expect(again.sha256).toBe(card.sha256)
    await post({ ...input, purpose: 'save', expectedSha256: card.sha256 }).expect(200)
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { user_id: member, event_type: 'share_card_export_authorized' },
    })
    expect(audit.event_data).toEqual({
      sourceKind: 'outfit',
      locale: 'en-US',
      watermark: true,
      templateVersion: 1,
    })
    expect(reads).toBe(0)
  })
  it('M1-HTTP: rapid replacement waits for a disconnected renderer and returns the newest composition', async () => {
    const row = await outfit()
    const body = preview({ kind: 'outfit', recommendationId: row.id })
    let release!: () => void
    let entered!: () => void
    let firstSignal: AbortSignal | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const rendering = new Promise<void>((resolve) => {
      entered = resolve
    })
    const originalRender = renderer.prepare.bind(renderer) as ShareCardRenderer['prepare']
    const render = vi
      .spyOn(renderer, 'prepare')
      .mockImplementationOnce(async (...args) => {
        firstSignal = args[4]
        entered()
        await held
        return originalRender(...args)
      })
    const prepare = vi.spyOn(service, 'prepare')
    const parent = new AbortController()
    const first = fetch(`${url}/api/v1/share-cards/prepare`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${member}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: parent.signal,
    }).catch((error: unknown) => error)
    let second: Promise<request.Response> | undefined
    try {
      await rendering
      parent.abort()
      await first
      await vi.waitFor(() => expect(firstSignal?.aborted).toBe(true))
      second = post({ ...body, watermark: false }).then((response) => response)
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
      expect(render).toHaveBeenCalledOnce()
      release()
      const response = await second
      expect(response.status).toBe(200)
      const card = prepareShareCardResponseSchema.parse(response.body).data
      expect(digest(Buffer.from(decodeShareCardBase64(card.pngBase64)))).toBe(card.sha256)
      expect(render).toHaveBeenCalledTimes(2)
      expect(render.mock.calls[1]?.[2]).toBe(false)
      const expected = await post({ ...body, watermark: false }).expect(200)
      expect(card.sha256).toBe(
        prepareShareCardResponseSchema.parse(expected.body).data.sha256
      )
    } finally {
      parent.abort()
      release()
      await first
      await second
      render.mockRestore()
      prepare.mockRestore()
    }
  })
  it.each(['consent', 'withdrawal', 'source'] as const)(
    'I-AUDIT-RACE: %s during actual audit INSERT await refuses HTTP save and rolls back authorization audit',
    async (change) => {
      let consentId = ''
      if (change === 'consent') {
        await prisma.userProfile.update({
          where: { user_id: member },
          data: { birthdate: teenBirthdate() },
        })
        consentId = (
          await prisma.guardianConsent.create({
            data: { guardian_id: other, teen_id: member, status: 'granted' },
          })
        ).id
      }
      const row = change === 'withdrawal' ? await photoPost() : await outfit()
      const source: Record<string, string> =
        change === 'withdrawal'
          ? { kind: 'community_post', postId: row.id }
          : { kind: 'outfit', recommendationId: row.id }
      const body = preview(source)
      const card = prepareShareCardResponseSchema.parse(
        (await post(body).expect(200)).body
      ).data
      let entered!: () => void
      let release!: () => void
      const inserting = new Promise<void>((resolve) => {
        entered = resolve
      })
      const resume = new Promise<void>((resolve) => {
        release = resolve
      })
      const transactional = {
        $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          prisma.$transaction(async (tx) => {
            const guarded = new Proxy(tx, {
              get(target, key) {
                if (key === 'auditLog')
                  return {
                    create: async (args: Prisma.AuditLogCreateArgs) => {
                      const audit = await target.auditLog.create(args)
                      entered()
                      await resume
                      return audit
                    },
                  }
                const value: unknown = Reflect.get(target, key)
                return value
              },
            })
            return work(guarded)
          }),
      }
      const delayed = new ShareCardsService(
        transactional as never,
        sources,
        renderer,
        storage
      )
      const prepare = vi
        .spyOn(service, 'prepare')
        .mockImplementationOnce((actor, input, signal) =>
          delayed.prepare(actor, input, signal)
        )
      const saving = post({ ...body, purpose: 'save', expectedSha256: card.sha256 }).then(
        (response) => response
      )
      try {
        await inserting
        if (change === 'consent')
          await prisma.guardianConsent.update({
            where: { id: consentId },
            data: { status: 'revoked', revoked_at: new Date() },
          })
        else if (change === 'withdrawal')
          await prisma.lookbookPost.update({
            where: { id: row.id },
            data: { status: 'withdrawn' },
          })
        else
          await prisma.outfitRecommendation.update({
            where: { id: row.id },
            data: { scenario: 'evening' },
          })
        release()
        expect((await saving).status).toBe(
          change === 'consent' ? 403 : change === 'withdrawal' ? 404 : 409
        )
        expect(
          await prisma.auditLog.count({
            where: { user_id: member, event_type: 'share_card_export_authorized' },
          })
        ).toBe(0)
      } finally {
        release()
        prepare.mockRestore()
      }
    }
  )
  it('I-OUTFIT: capsule revision uses the global persisted ritual revision', async () => {
    const capsule = await prisma.outfitCapsule.create({
      data: {
        user_id: member,
        name: 'Sensitive garment NAME',
        revision: 2,
        occasions: ['work'],
      },
    })
    await prisma.userProfile.update({
      where: { user_id: member },
      data: { capsule_revision: 7 },
    })
    const row = await prisma.outfitRecommendation.create({
      data: {
        user_id: member,
        scenario: 'evening',
        garment_ids: ['default-dress'],
        capsule_id: capsule.id,
        capsule_revision: 7,
      },
    })
    const input = preview({ kind: 'outfit', recommendationId: row.id })
    await post(input).expect(200)
    await prisma.userProfile.update({
      where: { user_id: member },
      data: { capsule_revision: 8 },
    })
    await post(input).expect(404)
  })
  it('I-OUTFIT-DENY: missing, foreign, malformed, duplicate and inactive garments fail closed', async () => {
    const foreign = await outfit(other)
    for (const id of ['missing', foreign.id])
      await post(preview({ kind: 'outfit', recommendationId: id })).expect(404)
    for (const ids of [
      [],
      ['default-top', 'default-top'],
      ['default-top-URL'],
      ['missing-garment'],
      Array.from({ length: 13 }, (_, index) => `garment-${index}`),
    ]) {
      const row = await outfit(member, ids)
      await post(preview({ kind: 'outfit', recommendationId: row.id })).expect(404)
    }
    const real = await prisma.garmentItem.create({
      data: {
        user_id: member,
        category: 'top',
        material: 'cotton',
        comfort_range: 'mild',
        upload_status: 'ready',
      },
    })
    const row = await outfit(member, [real.id])
    await post(preview({ kind: 'outfit', recommendationId: row.id })).expect(200)
    await prisma.garmentItem.update({
      where: { id: real.id },
      data: { retention_status: 'deletion_pending' },
    })
    await post(preview({ kind: 'outfit', recommendationId: row.id })).expect(404)
    for (const data of [
      { user_id: other, upload_status: 'ready', category: 'top' },
      { user_id: member, upload_status: 'pending_upload', category: 'top' },
    ] as const) {
      const garment = await prisma.garmentItem.create({
        data: { ...data, material: 'cotton', comfort_range: 'mild' },
      })
      const invalid = await outfit(member, [garment.id])
      await post(preview({ kind: 'outfit', recommendationId: invalid.id })).expect(404)
    }
    const malformed = await outfit()
    await prisma.outfitRecommendation.update({
      where: { id: malformed.id },
      data: { scenario: 'unknown-scenario' },
    })
    await post(preview({ kind: 'outfit', recommendationId: malformed.id })).expect(404)
  })
  it('I-POST I-PRIVACY: own public photo only, metadata/free-text cannot change rendered bytes', async () => {
    const row = await photoPost()
    const input = preview({ kind: 'community_post', postId: row.id })
    const first = prepareShareCardResponseSchema.parse(
      (await post(input).expect(200)).body
    ).data
    await prisma.lookbookPost.update({
      where: { id: row.id },
      data: {
        caption: 'different private name',
        alt_text: 'other location URL',
        location_key: 'private exact city',
        locale: 'tr-TR',
      },
    })
    const next = prepareShareCardResponseSchema.parse(
      (await post(input).expect(200)).body
    ).data
    expect(next.sha256).toBe(first.sha256)
    const bytes = Buffer.from(decodeShareCardBase64(next.pngBase64))
    expect(bytes.includes(Buffer.from('private.invalid'))).toBe(false)
    expect([
      ...(await sharp(bytes)
        .extract({ left: 100, top: 300, width: 1, height: 1 })
        .raw()
        .toBuffer()),
    ]).toEqual([36, 104, 138])
  })
  it.each([
    'draft',
    'uploading',
    'pending_review',
    'flagged',
    'review_failed',
    'withdrawn',
    'consent_suspended',
  ] as const)('I-POST-DENY: %s never downloads media', async (status) => {
    const row = await photoPost(status)
    await post(preview({ kind: 'community_post', postId: row.id })).expect(404)
    expect(reads).toBe(0)
  })
  it('I-POST-DENY: a negative persisted byte size is unavailable before any storage request', async () => {
    const row = await photoPost()
    await prisma.lookbookPost.update({
      where: { id: row.id },
      data: { image_byte_size: -1 },
    })
    await post(preview({ kind: 'community_post', postId: row.id })).expect(404)
    expect(reads).toBe(0)
  })
  it('I-POST-DENY: foreign and missing published posts do not download', async () => {
    const foreign = await photoPost('published', other)
    for (const id of [foreign.id, 'missing'])
      await post(preview({ kind: 'community_post', postId: id })).expect(404)
    expect(reads).toBe(0)
  })
  it.each(['erasure_requested_at', 'anonymized_at'] as const)(
    'I-POST-DENY: %s visibility guard prevents media fetch',
    async (field) => {
      const row = await photoPost()
      await prisma.lookbookPost.update({
        where: { id: row.id },
        data: { [field]: new Date() },
      })
      await post(preview({ kind: 'community_post', postId: row.id })).expect(404)
      expect(reads).toBe(0)
    }
  )
  it('I-POST-DENY: the migrated database prevents published rows without a publication timestamp', async () => {
    const row = await photoPost()
    await expect(
      prisma.lookbookPost.update({ where: { id: row.id }, data: { published_at: null } })
    ).rejects.toThrow('LookbookPost_published_at_required_when_published')
    expect(reads).toBe(0)
  })
  it('I-POST-DENY: operations canary ownership never exposes its photo', async () => {
    const canary = `canary-user-${randomUUID()}`
    await prisma.user.create({
      data: {
        id: canary,
        email: `${randomUUID()}@cc68.test`,
        profile: { create: { birthdate: new Date('1990-01-01') } },
      },
    })
    const row = await photoPost('published', canary)
    await post(preview({ kind: 'community_post', postId: row.id }), canary).expect(404)
    expect(reads).toBe(0)
  })
  it('I-ACCESS: live revoked guardian consent blocks both source kinds', async () => {
    await prisma.userProfile.update({
      where: { user_id: member },
      data: { birthdate: teenBirthdate() },
    })
    const consent = await prisma.guardianConsent.create({
      data: { guardian_id: other, teen_id: member, status: 'granted' },
    })
    const row = await outfit()
    const input = preview({ kind: 'outfit', recommendationId: row.id })
    await post(input).expect(200)
    await prisma.guardianConsent.update({
      where: { id: consent.id },
      data: { status: 'revoked', revoked_at: new Date() },
    })
    await post(input).expect(403)
    const published = await photoPost()
    await post(preview({ kind: 'community_post', postId: published.id })).expect(403)
    expect(reads).toBe(0)
  })
  it('I-ACCESS: signed-out, flag-off, under-age and suspended members are denied', async () => {
    const row = await photoPost()
    const input = preview({ kind: 'community_post', postId: row.id })
    await request(url).post('/api/v1/share-cards/prepare').send(input).expect(401)
    flags.communityReadEvaluation.mockResolvedValue({
      value: false,
      expiresAt: new Date('2099-01-01'),
      validUntil: Number.MAX_SAFE_INTEGER,
    })
    await post(input).expect(403)
    flags.communityReadEvaluation.mockResolvedValue({
      value: true,
      expiresAt: new Date('2099-01-01'),
      validUntil: Number.MAX_SAFE_INTEGER,
    })
    await prisma.userProfile.update({
      where: { user_id: member },
      data: { birthdate: new Date() },
    })
    await post(input).expect(403)
    await prisma.userProfile.update({
      where: { user_id: member },
      data: {
        birthdate: new Date('1990-01-01'),
        preferences: { compliance: { accountStatus: 'suspended' } },
      },
    })
    await post(input).expect(403)
    expect(reads).toBe(0)
  })
  it('U-CONTRACT I-MEDIA: injected and extra-field bodies get 400 from the real route before any source read', async () => {
    const row = await photoPost()
    const input = preview({ kind: 'community_post', postId: row.id })
    const prepare = vi.spyOn(service, 'prepare')
    try {
      for (const body of [
        { ...input, url: 'https://private.invalid/photo.png' },
        { ...input, source: { ...input.source, path: row.image_object_path } },
        {
          ...input,
          source: { kind: 'community_post', postId: 'https://private.invalid' },
        },
        { ...input, source: { kind: 'community_post', postId: `../${row.id}` } },
        { ...input, expectedSha256: 'a'.repeat(64) },
        { ...input, purpose: 'save' },
      ]) {
        const refused = await post(body).expect(400)
        expect(refused.body).toMatchObject({ statusCode: 400 })
        expect(refused.body).not.toHaveProperty('data')
      }
      expect(prepare).not.toHaveBeenCalled()
      expect(reads).toBe(0)
      await post(input).expect(200)
      expect(prepare).toHaveBeenCalledOnce()
    } finally {
      prepare.mockRestore()
    }
  })
  it('I-MEDIA: stored byte declaration mismatch fails without partial PNG', async () => {
    const row = await photoPost()
    await prisma.lookbookPost.update({
      where: { id: row.id },
      data: { image_checksum: 'f'.repeat(64) },
    })
    const failed = await post(preview({ kind: 'community_post', postId: row.id })).expect(
      503
    )
    expect(failed.body).not.toHaveProperty('data')
  })
  it.each(['slow', 'oversized'] as const)(
    'I-BOUNDS: actual %s HTTP media stream is bounded outside authorization transaction',
    async (mode) => {
      const row = await photoPost()
      const object = `/storage/v1/object/authenticated/community-images/${row.image_object_path}`
      delivery.set(object, mode)
      const failed = await post(
        preview({ kind: 'community_post', postId: row.id })
      ).expect(503)
      expect(failed.body).not.toHaveProperty('data')
      // The slow object completes at 7 s. The download bound closed it before then.
      if (mode === 'slow')
        await vi.waitFor(() => expect(cutShort.has(object)).toBe(true), { timeout: 1000 })
    },
    10000
  )
  it.each(['corrupt', 'multiframe'] as const)(
    'I-MEDIA: actual %s media fails decode without a card',
    async (mode) => {
      const row = await photoPost()
      const frames = Buffer.alloc(256 * 512 * 3, 200)
      frames.fill(20, 256 * 256 * 3)
      const bytes =
        mode === 'corrupt'
          ? Buffer.from('not a PNG')
          : await sharp(frames, {
              raw: { width: 256, height: 512, channels: 3, pageHeight: 256 },
            })
              .webp({ loop: 0 })
              .toBuffer()
      if (mode === 'multiframe')
        expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2)
      objects.set(
        `/storage/v1/object/authenticated/community-images/${row.image_object_path}`,
        bytes
      )
      await prisma.lookbookPost.update({
        where: { id: row.id },
        data: {
          image_byte_size: bytes.length,
          image_checksum: digest(bytes),
          image_content_type: mode === 'multiframe' ? 'image/webp' : 'image/png',
        },
      })
      const failed = await post(
        preview({ kind: 'community_post', postId: row.id })
      ).expect(503)
      expect(failed.body).not.toHaveProperty('data')
    }
  )
  it.each(['withdrawal', 'consent', 'flag', 'source'] as const)(
    'I-RACE: synchronized %s during save rendering blocks final authorization and audit',
    async (mutation) => {
      const row = await photoPost()
      const input = preview({ kind: 'community_post', postId: row.id })
      let consentId: string | undefined
      if (mutation === 'consent') {
        await prisma.userProfile.update({
          where: { user_id: member },
          data: { birthdate: teenBirthdate() },
        })
        consentId = (
          await prisma.guardianConsent.create({
            data: { guardian_id: other, teen_id: member, status: 'granted' },
          })
        ).id
      }
      const card = prepareShareCardResponseSchema.parse(
        (await post(input).expect(200)).body
      ).data
      let release!: () => void
      let entered!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const real = renderer.render.bind(renderer) as ShareCardRenderer['render']
      const spy = vi.spyOn(renderer, 'render').mockImplementationOnce(async (...args) => {
        entered()
        await gate
        return real(...args)
      })
      const response = post({
        ...input,
        purpose: 'save',
        expectedSha256: card.sha256,
      }).then((result) => result)
      await started
      try {
        if (mutation === 'withdrawal')
          await prisma.lookbookPost.update({
            where: { id: row.id },
            data: { status: 'withdrawn' },
          })
        if (mutation === 'consent')
          await prisma.guardianConsent.update({
            where: { id: consentId! },
            data: { status: 'revoked', revoked_at: new Date() },
          })
        if (mutation === 'flag')
          flags.communityReadEvaluation.mockResolvedValue({
            value: false,
            expiresAt: new Date('2099-01-01'),
            validUntil: Number.MAX_SAFE_INTEGER,
          })
        if (mutation === 'source')
          await prisma.lookbookPost.update({
            where: { id: row.id },
            data: { climate_band: 'warm_wet' },
          })
      } finally {
        release()
      }
      try {
        expect((await response).status).toBe(
          mutation === 'source' ? 409 : mutation === 'withdrawal' ? 404 : 403
        )
        expect(await prisma.auditLog.count({ where: { user_id: member } })).toBe(0)
      } finally {
        spy.mockRestore()
      }
    }
  )
  it('I-ACCESS: erased subject profile blocks both source kinds before media reads', async () => {
    const rec = await outfit()
    const published = await photoPost()
    await prisma.userProfile.update({
      where: { user_id: member },
      data: { preferences: { compliance: { accountStatus: 'erased' } } },
    })
    await post(preview({ kind: 'outfit', recommendationId: rec.id })).expect(403)
    await post(preview({ kind: 'community_post', postId: published.id })).expect(403)
    expect(reads).toBe(0)
  })
  it('I-RACE: changed composition returns 409 and creates no save audit', async () => {
    const row = await outfit()
    const input = preview({ kind: 'outfit', recommendationId: row.id })
    const card = prepareShareCardResponseSchema.parse(
      (await post(input).expect(200)).body
    ).data
    await prisma.outfitRecommendation.update({
      where: { id: row.id },
      data: { garment_ids: ['default-dress'] },
    })
    await post({ ...input, purpose: 'save', expectedSha256: card.sha256 }).expect(409)
    expect(await prisma.auditLog.count({ where: { user_id: member } })).toBe(0)
  })
  it('I-AUDIT: database audit rejection blocks accepted save authorization', async () => {
    const row = await outfit()
    const input = preview({ kind: 'outfit', recommendationId: row.id })
    const card = prepareShareCardResponseSchema.parse(
      (await post(input).expect(200)).body
    ).data
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION cc68_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit rejection'; END $$"
    )
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER cc68_reject_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION cc68_reject_audit()'
    )
    try {
      await post({ ...input, purpose: 'save', expectedSha256: card.sha256 }).expect(503)
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER cc68_reject_audit ON "AuditLog"')
      await prisma.$executeRawUnsafe('DROP FUNCTION cc68_reject_audit()')
    }
  })
})
