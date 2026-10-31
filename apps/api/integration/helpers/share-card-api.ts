/**
 * The shared harness for the share-card API integration specs: the real ShareCardsService,
 * flag policy and controller over an isolated, migrated database, with a loopback storage
 * server. `share-card-export.integration.spec.ts` (Story 6.8) and
 * `share-card-share.integration.spec.ts` (Story 6.9) each call `useShareCardApi()` once at
 * file scope; vitest isolates files, so each spec gets its own database and app.
 *
 * `app`, `url`, `member`, `other`, `photo` and `reads` are exported `let` bindings that the
 * hooks below reassign; ES module live bindings let the specs read the current value.
 */
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient, type CommunityPostStatus } from '@prisma/client'
import request from 'supertest'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import { isolatedCommunityDatabase } from './isolated-community-database.js'
import { listenHttpApp, listenHttpHandler } from '../../src/testing/loopback-http-app.js'
import { AccessTokenIdentityService } from '../../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../../src/modules/auth/guardian-consent-state.service.js'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import { CommunityService } from '../../src/modules/community/community.service.js'
import { SupabaseCommunityStorageAdapter } from '../../src/modules/community/community-storage.adapter.js'
import { ShareCardSourceRepository } from '../../src/modules/share-cards/share-card-source.repository.js'
import { ShareCardRenderer } from '../../src/modules/share-cards/share-card-renderer.js'
import { ShareCardsService } from '../../src/modules/share-cards/share-cards.service.js'
import { ShareCardsController } from '../../src/modules/share-cards/share-cards.controller.js'
import { FeatureFlagsRepository } from '../../src/modules/feature-flags/feature-flags.repository.js'
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service.js'

const database = isolatedCommunityDatabase()
export const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
export const flags = {
  communityReadEvaluation: vi.fn(() =>
    Promise.resolve({
      value: true,
      expiresAt: new Date('2099-01-01'),
      validUntil: Number.MAX_SAFE_INTEGER,
    })
  ),
}
const repository = new CommunityRepository(prisma)
export const storage = new SupabaseCommunityStorageAdapter()
const community = new CommunityService(
  repository,
  flags as never,
  {} as never,
  {} as never,
  storage,
  {} as never
)
export const sources = new ShareCardSourceRepository(prisma, community)
export const renderer = new ShareCardRenderer()
// Story 6.9: the real flag policy over the isolated database, with PostHog down, so
// every share answer comes from the Postgres fallback row or the code default.
const posthogDown = {
  getFeatureFlagValue: () => Promise.reject(new Error('posthog unavailable')),
}
export const featureFlags = new FeatureFlagsService(
  new FeatureFlagsRepository(prisma),
  posthogDown
)
export const service = new ShareCardsService(
  prisma,
  sources,
  renderer,
  storage,
  featureFlags
)
export const SHARE_FLAG = 'share_card_native_share_enabled'
/** Sets the Postgres fallback row for the share flag; null removes it. */
export async function shareFlagRow(value: boolean | null) {
  if (value === null) await prisma.featureFlag.deleteMany({ where: { key: SHARE_FLAG } })
  else
    await prisma.featureFlag.upsert({
      where: { key: SHARE_FLAG },
      create: { key: SHARE_FLAG, value },
      update: { value },
    })
}
export const capabilities = (actor = member) =>
  request(url)
    .get('/api/v1/share-cards/capabilities')
    .set('Authorization', `Bearer ${actor}`)
export const objects = new Map<string, Buffer>()
export const delivery = new Map<string, 'slow' | 'oversized'>()
export const cutShort = new Set<string>()
export let reads = 0
export let app: INestApplication
export let url: string
let storageServer: Awaited<ReturnType<typeof listenHttpHandler>>
export let member: string
export let other: string
export let photo: Buffer
export const preview = (source: Record<string, string>) => ({
  source,
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
})
export const post = (body: object | string, actor = member) =>
  request(url)
    .post('/api/v1/share-cards/prepare')
    .set('Authorization', `Bearer ${actor}`)
    .send(body)
export const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
/** Fifteen years before the live clock the age rule reads, so the member stays a teen. */
export function teenBirthdate() {
  const birthdate = new Date()
  birthdate.setUTCFullYear(birthdate.getUTCFullYear() - 15)
  return birthdate
}
export async function user(birthdate = new Date('1990-01-01')) {
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
export async function outfit(
  actor = member,
  garmentIds: string[] = ['default-top', 'default-bottom']
) {
  return prisma.outfitRecommendation.create({
    data: { user_id: actor, scenario: 'morning', garment_ids: garmentIds },
  })
}
export async function photoPost(
  status: CommunityPostStatus = 'published',
  actor = member
) {
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
/** Registers the harness lifecycle; call once at the top of a spec file. */
export function useShareCardApi() {
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
}
