// Learning path Step 81: Photo AI consent and processor approval.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-81-photo-ai-consent-and-processor-approval
import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { Logger, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { createUser, persistUser } from '@couture/testing'
import { buildCommunityObjectPath, buildWardrobeObjectPath } from '@couture/utils'
import { PrismaClient, type Prisma } from '@prisma/client'
import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoAiExecutionService } from '../src/modules/photo-ai/photo-ai-execution.service.js'
import { PhotoAiConsentController } from '../src/modules/photo-ai/photo-ai-consent.controller.js'
import {
  bindRequestContext,
  getRequestContext,
  runWithRequestContext,
} from '../src/logger/request-context.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { PhotoAiGrantGate } from '../src/modules/photo-ai/photo-ai-grant-gate.js'
import {
  PRODUCTION_PHOTO_AI_POLICY,
  type PhotoAiPolicy,
} from '../src/modules/photo-ai/photo-ai-policy.js'
import { PhotoAiSourceService } from '../src/modules/photo-ai/photo-ai-source.service.js'
import type { BoundedDownload } from '../src/modules/wardrobe/wardrobe-storage.adapter.js'
import { httpTestUrl, listenHttpApp } from '../src/testing/loopback-http-app.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  deleteMembers,
  updateGuardianConsent,
  updatePost,
} from './helpers/privacy-guards.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const PATH = '/api/v1/privacy/photo-ai-consent'
const EMPTY = { data: { externalProcessingEnabled: false, grants: [] } }

const OWNER = { userId: 'synthetic-photo-owner' }
const OTHER = { userId: 'synthetic-photo-other' }
const TEEN = { userId: 'synthetic-photo-teen' }
const MISSING_TEEN = 'synthetic-missing-photo-teen'
const RELATIONSHIP = 'synthetic-photo-guardian-consent'
const GRANT_ID = 'synthetic-photo-grant'
const TEEN_GRANT_ID = 'synthetic-photo-teen-grant'
const SCOPE = {
  grantId: GRANT_ID,
  feature: 'garment-tags',
  inputClass: 'garment-photo',
  provider: 'synthetic-photo-processor',
  photoId: 'a0e27d2f-e4a8-4a15-a2a7-af716b39db5a',
} as const
const TEEN_SCOPE = {
  ...SCOPE,
  grantId: TEEN_GRANT_ID,
  photoId: '9d8026bc-d8cb-4f70-bb77-c580e8b21ec8',
} as const
const COMMUNITY_SCOPE = {
  ...SCOPE,
  grantId: 'synthetic-community-photo-grant',
  feature: 'community-description',
  inputClass: 'community-photo',
  photoId: 'synthetic-photo-post',
} as const
const COMMUNITY_OBJECT = buildCommunityObjectPath(
  COMMUNITY_SCOPE.photoId,
  'fixture-upload',
  'jpg'
)
const POLICY_VERSION = 'synthetic-approved-version'
const tagRules = PRODUCTION_PHOTO_AI_POLICY.features['garment-tags']
const FIXTURE_POLICY: PhotoAiPolicy = {
  features: {
    ...PRODUCTION_PHOTO_AI_POLICY.features,
    'garment-tags': {
      ...tagRules,
      policyVersion: POLICY_VERSION,
      ageBands: { ...tagRules.ageBands, '18+': true, '13-15': true, '16-17': true },
    },
    'garment-cutout': {
      ...PRODUCTION_PHOTO_AI_POLICY.features['garment-cutout'],
      policyVersion: POLICY_VERSION,
      ageBands: { ...tagRules.ageBands, '18+': true },
    },
    'community-description': {
      ...PRODUCTION_PHOTO_AI_POLICY.features['community-description'],
      policyVersion: POLICY_VERSION,
      ageBands: { ...tagRules.ageBands, '18+': true },
    },
  },
  approvedProcessors: [
    {
      feature: SCOPE.feature,
      inputClass: SCOPE.inputClass,
      provider: SCOPE.provider,
      policyVersion: POLICY_VERSION,
    },
    {
      feature: COMMUNITY_SCOPE.feature,
      inputClass: COMMUNITY_SCOPE.inputClass,
      provider: COMMUNITY_SCOPE.provider,
      policyVersion: POLICY_VERSION,
    },
    {
      feature: 'garment-cutout',
      inputClass: SCOPE.inputClass,
      provider: SCOPE.provider,
      policyVersion: POLICY_VERSION,
    },
    {
      feature: SCOPE.feature,
      inputClass: SCOPE.inputClass,
      provider: 'second-approved-processor',
      policyVersion: POLICY_VERSION,
    },
  ],
}
const PROCESSOR_RESULT = { tags: ['synthetic-tag'] }
const grantedAt = new Date(Date.now() - 2 * 86_400_000)
const expiresAt = new Date(Date.now() + 2 * 86_400_000)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function activeProfile() {
  return { compliance: { accountStatus: 'active', guardianConsentRequired: false } }
}

function birthdate(age: number) {
  return new Date(Date.UTC(new Date().getUTCFullYear() - age, 0, 1))
}

function grant(userId: string, id: string): Prisma.PhotoAiGrantUncheckedCreateInput {
  return {
    user_id: userId,
    id,
    feature: SCOPE.feature,
    input_class: SCOPE.inputClass,
    provider: SCOPE.provider,
    policy_version: POLICY_VERSION,
    granted_at: grantedAt,
    expires_at: expiresAt,
  }
}

function harness(image: Buffer, policy = FIXTURE_POLICY) {
  const download = vi.fn<() => Promise<BoundedDownload>>(() =>
    Promise.resolve({ status: 'present' as const, bytes: Buffer.from(image) })
  )
  const downloadCommunity = vi.fn(() => Promise.resolve(Buffer.from(image)))
  const sourceService = new PhotoAiSourceService(
    { downloadBounded: downloadCommunity },
    { downloadBounded: download }
  )
  const source = {
    resolve: vi.spyOn(sourceService, 'resolve'),
    read: vi.spyOn(sourceService, 'read'),
  }
  const gate = new PhotoAiGrantGate(prisma, policy)
  const execute = new PhotoAiExecutionService(gate, sourceService)
  const process = vi.fn(
    (_input: { bytes: Buffer; mimeType: string }, _signal: AbortSignal) =>
      Promise.resolve(PROCESSOR_RESULT)
  )
  return {
    adapter: { provider: SCOPE.provider, process },
    download,
    downloadCommunity,
    execute,
    gate,
    process,
    source,
    sourceService,
  }
}

describe('CC-7.24 photo AI execution with persisted consent', () => {
  let image: Buffer
  let app: INestApplication

  beforeAll(async () => {
    await database.migrate()
    await persistUser(
      prisma,
      createUser({
        id: OWNER.userId,
        birthdate: new Date('1985-05-03T00:00:00.000Z'),
        profilePreferences: activeProfile(),
      })
    )
    await persistUser(
      prisma,
      createUser({
        id: OTHER.userId,
        birthdate: new Date('1987-05-03T00:00:00.000Z'),
        profilePreferences: activeProfile(),
      })
    )
    await persistUser(
      prisma,
      createUser({
        id: TEEN.userId,
        role: 'teen',
        birthdate: birthdate(15),
        profilePreferences: activeProfile(),
      })
    )
    await prisma.guardianConsent.create({
      data: {
        id: RELATIONSHIP,
        teen_id: TEEN.userId,
        guardian_id: OWNER.userId,
        status: 'granted',
        consent_granted_at: grantedAt,
      },
    })
    image = await sharp({
      create: { width: 256, height: 256, channels: 3, background: '#4b6aac' },
    })
      .withExif({ IFD0: { Artist: 'synthetic private metadata' } })
      .jpeg()
      .toBuffer()
    await prisma.garmentItem.createMany({
      data: [
        [OWNER.userId, SCOPE.photoId],
        [TEEN.userId, TEEN_SCOPE.photoId],
      ].map(([userId, photoId]) => ({
        user_id: userId!,
        id: photoId!,
        object_path: buildWardrobeObjectPath(userId!, 'garment', photoId!, 'jpg'),
        mime_type: 'image/jpeg',
        file_size_bytes: image.length,
        content_sha256: createHash('sha256').update(image).digest('hex'),
        committed_at: grantedAt,
        upload_status: 'ready',
      })),
    })
    await prisma.lookbookPost.create({
      data: {
        id: COMMUNITY_SCOPE.photoId,
        user_id: OWNER.userId,
        status: 'draft',
        upload_expires_at: expiresAt,
        image_object_path: COMMUNITY_OBJECT,
        image_content_type: 'image/jpeg',
        image_byte_size: image.length,
        image_checksum: createHash('sha256').update(image).digest('hex'),
      },
    })
    const routes = await Test.createTestingModule({
      controllers: [PhotoAiConsentController],
      providers: [
        { provide: PrismaClient, useValue: prisma },
        {
          provide: PhotoAiGrantGate,
          useValue: new PhotoAiGrantGate(prisma, PRODUCTION_PHOTO_AI_POLICY),
        },
        GuardianConsentStateService,
        {
          provide: AccessTokenIdentityService,
          useValue: {
            resolveIdentity: (token: string) => {
              if (token === OWNER.userId || token === OTHER.userId)
                return { userId: token, role: 'guardian' }
              if (token === MISSING_TEEN) return { userId: token, role: 'teen' }
              throw new Error('Unknown fixture bearer')
            },
          },
        },
      ],
    }).compile()
    app = routes.createNestApplication()
    app.use(bindRequestContext)
    await listenHttpApp(app)
  }, 60_000)

  beforeEach(async () => {
    await prisma.photoAiGrant.deleteMany()
    await updateGuardianConsent(
      prisma,
      { id: RELATIONSHIP },
      { status: 'granted', revoked_at: null, consent_granted_at: grantedAt }
    )
    await prisma.userProfile.update({
      where: { user_id: TEEN.userId },
      data: { birthdate: birthdate(15), preferences: activeProfile() },
    })
    await prisma.photoAiGrant.createMany({
      data: [
        grant(OWNER.userId, GRANT_ID),
        {
          ...grant(TEEN.userId, TEEN_GRANT_ID),
          guardian_consent_id: RELATIONSHIP,
          teen_assented_at: grantedAt,
          guardian_approved_at: grantedAt,
        },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
    await prisma.$disconnect()
    await database.drop()
  })

  it('denies a token whose teen account is missing without logging the member identity', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await request(httpTestUrl(app))
        .get(PATH)
        .set('authorization', `Bearer ${MISSING_TEEN}`)
        .expect(403)

      expect(JSON.stringify(warn.mock.calls)).not.toContain(MISSING_TEEN)
    } finally {
      warn.mockRestore()
    }
  })

  it('returns service unavailable when the private route cannot verify teen access', async () => {
    const access = vi
      .spyOn(GuardianConsentStateService.prototype, 'canTeenAccessNonUploadSurface')
      .mockRejectedValueOnce(new Error('Synthetic private DB outage'))
    try {
      await request(httpTestUrl(app))
        .get(PATH)
        .set('authorization', `Bearer ${MISSING_TEEN}`)
        .expect(503)
      expect(access).toHaveBeenCalledExactlyOnceWith(MISSING_TEEN)
    } finally {
      access.mockRestore()
    }
  })

  it('lists and revokes only the authenticated member’s grants without exposing decision records', async () => {
    const api = request(httpTestUrl(app))
    const ownBearer = { authorization: `Bearer ${OWNER.userId}` }
    const otherBearer = { authorization: `Bearer ${OTHER.userId}` }
    const expected = {
      data: {
        externalProcessingEnabled: false,
        grants: [
          {
            id: GRANT_ID,
            feature: SCOPE.feature,
            inputClass: SCOPE.inputClass,
            provider: SCOPE.provider,
            policyVersion: POLICY_VERSION,
            expiresAt: expiresAt.toISOString(),
          },
        ],
      },
    }
    await api.get(PATH).expect(401)
    await api.post(`${PATH}/revoke`).send({ grantId: GRANT_ID }).expect(401)
    await api
      .get(PATH)
      .set(otherBearer)
      .expect(200, EMPTY)
      .expect('cache-control', 'private, no-store')
    await api
      .post(`${PATH}/revoke`)
      .set(otherBearer)
      .send({ grantId: GRANT_ID })
      .expect(200, EMPTY)
    await api
      .post(`${PATH}/revoke`)
      .set(ownBearer)
      .send({ grantId: GRANT_ID, userId: OTHER.userId })
      .expect(400)
    await api
      .get(PATH)
      .set(ownBearer)
      .expect(200, expected)
      .expect('cache-control', 'private, no-store')

    const revoke = () =>
      api.post(`${PATH}/revoke`).set(ownBearer).send({ grantId: GRANT_ID })
    await revoke().expect(200, EMPTY).expect('cache-control', 'private, no-store')
    const revoked = await prisma.photoAiGrant.findUniqueOrThrow({
      where: { id: GRANT_ID },
    })
    expect(revoked.revoked_at).toBeInstanceOf(Date)
    await revoke().expect(200, EMPTY)
    await expect(
      prisma.photoAiGrant.findUniqueOrThrow({ where: { id: GRANT_ID } })
    ).resolves.toMatchObject({
      revoked_at: revoked.revoked_at,
    })
    await api.get(PATH).set(ownBearer).expect(200, EMPTY)
  })

  it('makes no source read or dispatch under the production policy even with a stored grant', async () => {
    const { adapter, execute, process, source } = harness(
      image,
      PRODUCTION_PHOTO_AI_POLICY
    )

    await expect(execute.execute(OWNER, SCOPE, adapter)).resolves.toBeNull()
    expect(source.resolve).not.toHaveBeenCalled()
    expect(source.read).not.toHaveBeenCalled()
    expect(process).not.toHaveBeenCalled()
  })

  it.each([
    ['expired', { expires_at: new Date(+grantedAt + 1) }],
    ['revoked', { revoked_at: grantedAt }],
    ['superseded', { policy_version: 'previous-version' }],
  ] satisfies [string, Prisma.PhotoAiGrantUpdateInput][])(
    'stops a %s grant before reading the source',
    async (_state, change) => {
      await prisma.photoAiGrant.update({ where: { id: GRANT_ID }, data: change })
      const { adapter, execute, process, source } = harness(image)

      await expect(execute.execute(OWNER, SCOPE, adapter)).resolves.toBeNull()
      expect(source.resolve).not.toHaveBeenCalled()
      expect(source.read).not.toHaveBeenCalled()
      expect(process).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['missing member', { userId: '' }, SCOPE],
    ['missing key', OWNER, { ...SCOPE, grantId: 'missing-grant' }],
    ['different member', OTHER, SCOPE],
    ['different feature', OWNER, { ...SCOPE, feature: 'garment-cutout' }],
    ['wrong input class', OWNER, { ...SCOPE, inputClass: 'community-photo' }],
    [
      'different approved provider',
      OWNER,
      { ...SCOPE, provider: 'second-approved-processor' },
    ],
  ] as const)('rejects a %s before source resolution', async (_reason, actor, scope) => {
    const { execute, process, source } = harness(image)

    await expect(
      execute.execute(actor, scope, { provider: scope.provider, process })
    ).resolves.toBeNull()
    expect(source.resolve).not.toHaveBeenCalled()
    expect(process).not.toHaveBeenCalled()
  })

  it('keeps a mismatched adapter from reading a source or receiving bytes', async () => {
    const { execute, process, source } = harness(image)

    await expect(
      execute.execute(OWNER, SCOPE, { provider: 'unapproved-adapter', process })
    ).resolves.toBeNull()
    expect(source.resolve).not.toHaveBeenCalled()
    expect(process).not.toHaveBeenCalled()
  })

  it.each([
    ['teen assent', { teen_assented_at: null }],
    ['scoped guardian approval', { guardian_approved_at: null }],
    ['a linked guardian relationship', { guardian_consent: { disconnect: true } }],
  ] satisfies [string, Prisma.PhotoAiGrantUpdateInput][])(
    'requires current %s despite a granted guardian relationship',
    async (_reason, change) => {
      await prisma.photoAiGrant.update({ where: { id: TEEN_GRANT_ID }, data: change })
      const { adapter, execute, process, source } = harness(image)

      await expect(execute.execute(TEEN, TEEN_SCOPE, adapter)).resolves.toBeNull()
      expect(source.resolve).not.toHaveBeenCalled()
      expect(process).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['under 13', { birthdate: birthdate(12) }],
    ['unknown age', { birthdate: null }],
    [
      'pending guardian',
      { preferences: { compliance: { accountStatus: 'pending_guardian_consent' } } },
    ],
    ['suspended', { preferences: { compliance: { accountStatus: 'suspended' } } }],
    [
      'adult with a teen-era grant',
      {
        birthdate: new Date(new Date().setUTCFullYear(new Date().getUTCFullYear() - 18)),
      },
    ],
  ] satisfies [string, Prisma.UserProfileUpdateInput][])(
    'denies the %s account before storage',
    async (_reason, data) => {
      await prisma.userProfile.update({ where: { user_id: TEEN.userId }, data })
      const { adapter, execute, source, process } = harness(image)

      await expect(execute.execute(TEEN, TEEN_SCOPE, adapter)).resolves.toBeNull()
      expect(source.resolve).not.toHaveBeenCalled()
      expect(process).not.toHaveBeenCalled()
    }
  )

  it('rechecks the relationship and both decisions for a 17-year-old member', async () => {
    await prisma.userProfile.update({
      where: { user_id: TEEN.userId },
      data: { birthdate: birthdate(17) },
    })
    const { adapter, execute, process } = harness(image)
    await expect(execute.execute(TEEN, TEEN_SCOPE, adapter)).resolves.toEqual(
      PROCESSOR_RESULT
    )

    await updateGuardianConsent(
      prisma,
      { id: RELATIONSHIP },
      { status: 'revoked', revoked_at: new Date() }
    )
    await expect(execute.execute(TEEN, TEEN_SCOPE, adapter)).resolves.toBeNull()

    await updateGuardianConsent(
      prisma,
      { id: RELATIONSHIP },
      {
        status: 'granted',
        revoked_at: null,
        consent_granted_at: new Date(+grantedAt + 1000),
      }
    )
    await expect(execute.execute(TEEN, TEEN_SCOPE, adapter)).resolves.toBeNull()
    expect(process).toHaveBeenCalledOnce()
  })

  it('erases the grant through the account deletion cascade', async () => {
    const account = await prisma.user.create({
      data: { email: 'synthetic-photo-erasure@example.test' },
    })
    const id = 'synthetic-erased-photo-grant'
    await prisma.photoAiGrant.create({ data: grant(account.id, id) })

    await deleteMembers(prisma, { id: account.id })

    await expect(prisma.photoAiGrant.findUnique({ where: { id } })).resolves.toBeNull()
    await expect(
      prisma.photoAiGrant.findUnique({ where: { id: GRANT_ID } })
    ).resolves.not.toBeNull()
  })

  it('reads an authorized Community draft from its bounded private location and refuses a mismatched key', async () => {
    const { adapter, downloadCommunity, execute, process } = harness(image)
    await prisma.photoAiGrant.create({
      data: {
        ...grant(OWNER.userId, COMMUNITY_SCOPE.grantId),
        feature: COMMUNITY_SCOPE.feature,
        input_class: COMMUNITY_SCOPE.inputClass,
      },
    })

    await expect(execute.execute(OWNER, COMMUNITY_SCOPE, adapter)).resolves.toEqual(
      PROCESSOR_RESULT
    )
    expect(downloadCommunity).toHaveBeenCalledExactlyOnceWith(
      COMMUNITY_OBJECT,
      image.length,
      expect.any(AbortSignal)
    )

    try {
      await updatePost(prisma, COMMUNITY_SCOPE.photoId, {
        image_object_path: buildCommunityObjectPath(
          'different-post',
          'fixture-upload',
          'jpg'
        ),
      })
      await expect(execute.execute(OWNER, COMMUNITY_SCOPE, adapter)).resolves.toBeNull()
      expect(downloadCommunity).toHaveBeenCalledOnce()
      expect(process).toHaveBeenCalledOnce()
    } finally {
      await updatePost(prisma, COMMUNITY_SCOPE.photoId, {
        image_object_path: COMMUNITY_OBJECT,
      })
    }
  })

  it('keeps flat-lay reads closed until staging exists', async () => {
    const { download, downloadCommunity, sourceService } = harness(image)

    await expect(
      sourceService.resolve(prisma, OWNER.userId, 'flat-lay-photo', SCOPE.photoId)
    ).resolves.toBeNull()
    expect(download).not.toHaveBeenCalled()
    expect(downloadCommunity).not.toHaveBeenCalled()
  })

  it('dispatches only a newly authorized, sanitized photo when scope and decisions match', async () => {
    const { adapter, download, execute, process, source } = harness(image)
    let sanitized: Buffer | undefined
    let processorContext: ReturnType<typeof getRequestContext>
    process.mockImplementation(({ bytes }) => {
      sanitized = Buffer.from(bytes)
      processorContext = getRequestContext()
      return Promise.resolve(PROCESSOR_RESULT)
    })

    await expect(
      runWithRequestContext(
        { requestId: 'original-photo-request', userId: TEEN.userId },
        () => execute.execute(TEEN, TEEN_SCOPE, adapter)
      )
    ).resolves.toEqual(PROCESSOR_RESULT)
    expect(processorContext).toMatchObject({ suppressAccountContext: true })
    expect(processorContext?.userId).toBeUndefined()
    expect(processorContext?.requestId).not.toBe('original-photo-request')

    expect(source.resolve).toHaveBeenCalledWith(
      expect.anything(),
      TEEN.userId,
      TEEN_SCOPE.inputClass,
      TEEN_SCOPE.photoId
    )
    expect(source.read).toHaveBeenCalledOnce()
    expect(download).toHaveBeenCalledExactlyOnceWith(
      buildWardrobeObjectPath(TEEN.userId, 'garment', TEEN_SCOPE.photoId, 'jpg'),
      image.length,
      expect.any(AbortSignal)
    )
    expect(process).toHaveBeenCalledOnce()
    const [input, signal] = process.mock.calls[0]!
    expect(Object.keys(input).sort()).toEqual(['bytes', 'mimeType'])
    expect(input.mimeType).toBe('image/jpeg')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(input.bytes.equals(Buffer.alloc(input.bytes.length))).toBe(true)
    expect((await sharp(image).metadata()).exif).toBeDefined()
    const output = await sharp(sanitized).metadata()
    expect(output).toMatchObject({ width: 256, height: 256 })
    expect(output.exif).toBeUndefined()
    expect(output.icc).toBeUndefined()
    expect(output.xmp).toBeUndefined()
  })

  it('refuses a different owner’s photo before downloading anything', async () => {
    const { adapter, download, execute, process } = harness(image)

    await expect(
      execute.execute(OWNER, { ...SCOPE, photoId: TEEN_SCOPE.photoId }, adapter)
    ).resolves.toBeNull()
    expect(download).not.toHaveBeenCalled()
    expect(process).not.toHaveBeenCalled()
  })

  it('refuses bytes that no longer match the freshly authorized declaration', async () => {
    const { adapter, download, execute, process } = harness(image)
    const different = Buffer.from(image)
    different[25] = (different[25] ?? 0) ^ 1
    download.mockResolvedValueOnce({ status: 'present', bytes: different })

    await expect(execute.execute(OWNER, SCOPE, adapter)).resolves.toBeNull()
    expect(download).toHaveBeenCalledOnce()
    expect(process).not.toHaveBeenCalled()
  })

  it.each(['missing', 'too_large'] as const)(
    'drops a %s storage response before processing',
    async (status) => {
      const { adapter, download, execute, process } = harness(image)
      download.mockResolvedValueOnce({ status })

      await expect(execute.execute(OWNER, SCOPE, adapter)).resolves.toBeNull()
      expect(download).toHaveBeenCalledOnce()
      expect(process).not.toHaveBeenCalled()
    }
  )

  it('discards the result if the source is removed while processing', async () => {
    const { adapter, execute, process } = harness(image)
    const dispatched = deferred<void>()
    const reply = deferred<typeof PROCESSOR_RESULT>()
    process.mockImplementation(() => {
      dispatched.resolve()
      return reply.promise
    })

    const attempt = execute.execute(OWNER, SCOPE, adapter)
    await dispatched.promise
    try {
      await prisma.garmentItem.update({
        where: { id: SCOPE.photoId },
        data: { committed_at: null },
      })
      reply.resolve(PROCESSOR_RESULT)
      await expect(attempt).resolves.toBeNull()
    } finally {
      await prisma.garmentItem.update({
        where: { id: SCOPE.photoId },
        data: { committed_at: grantedAt },
      })
    }
  })

  it('handles a rejected processor and clears its in-memory buffer', async () => {
    const { adapter, execute, process } = harness(image)
    process.mockRejectedValueOnce(new Error('Synthetic processor failure'))

    await expect(execute.execute(OWNER, SCOPE, adapter)).resolves.toBeNull()
    expect(process).toHaveBeenCalledOnce()
    const [{ bytes }] = process.mock.calls[0]!
    expect(bytes.equals(Buffer.alloc(bytes.length))).toBe(true)
  })

  it('aborts a stalled processor at its deadline and clears the pending image', async () => {
    const { adapter, execute, process } = harness(image)
    const dispatched = deferred<AbortSignal>()
    const reply = deferred<typeof PROCESSOR_RESULT>()
    process.mockImplementation((_input, signal) => {
      dispatched.resolve(signal)
      return reply.promise
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const attempt = execute.execute(OWNER, SCOPE, adapter)
      const signal = await dispatched.promise
      await vi.advanceTimersByTimeAsync(9_999)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await expect(attempt).resolves.toBeNull()
      expect(signal.aborted).toBe(true)
      const [{ bytes }] = process.mock.calls[0]!
      expect(bytes.equals(Buffer.alloc(bytes.length))).toBe(true)
    } finally {
      reply.resolve(PROCESSOR_RESULT)
      vi.useRealTimers()
    }
  })

  it('stops dispatch when the owner revokes during an outstanding read', async () => {
    const { adapter, execute, gate, process, source } = harness(image)
    const readStarted = deferred<AbortSignal>()
    const photo = deferred<Buffer>()
    source.read.mockImplementation((_borrowed, signal) => {
      readStarted.resolve(signal)
      return photo.promise
    })

    const attempt = execute.execute(OWNER, SCOPE, adapter)
    const signal = await readStarted.promise
    await gate.revoke(OWNER.userId, GRANT_ID)
    const lateBytes = Buffer.from(image)
    photo.resolve(lateBytes)

    await expect(attempt).resolves.toBeNull()
    expect(signal.aborted).toBe(true)
    expect(lateBytes.equals(Buffer.alloc(lateBytes.length))).toBe(true)
    expect(process).not.toHaveBeenCalled()
  })

  it.each([
    ['same instance', true],
    ['another instance', false],
  ] as const)(
    'discards a processor reply after revocation from the %s',
    async (_location, sameInstance) => {
      const { adapter, execute, gate, process } = harness(image)
      const revoker = sameInstance ? gate : new PhotoAiGrantGate(prisma, FIXTURE_POLICY)
      const dispatched = deferred<AbortSignal>()
      const reply = deferred<typeof PROCESSOR_RESULT>()
      process.mockImplementation((_photo, signal) => {
        dispatched.resolve(signal)
        return reply.promise
      })

      const attempt = execute.execute(OWNER, SCOPE, adapter)
      const signal = await dispatched.promise
      await revoker.revoke(OWNER.userId, GRANT_ID)
      expect(signal.aborted).toBe(sameInstance)
      reply.resolve(PROCESSOR_RESULT)

      await expect(attempt).resolves.toBeNull()
      expect(process).toHaveBeenCalledOnce()
      await expect(gate.list(OWNER.userId)).resolves.toEqual([])
    }
  )
})
