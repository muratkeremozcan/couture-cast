import { UserController } from '../src/modules/user/user.controller.js'
import { UserService } from '../src/modules/user/user.service.js'
import { bindRequestContext } from '../src/logger/request-context.js'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApiClient, communitySyncClient } from '@couture/api-client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { listenHttpApp } from './helpers/loopback-http-app.js'
import { CommunitySyncController } from '../src/modules/community/community-sync.controller.js'
import { CommunitySyncService } from '../src/modules/community/community-sync.service.js'
import { CommunityTargetsService } from '../src/modules/community/community-targets.service.js'
import { CommunityPreferencesService } from '../src/modules/community/community-preferences.service.js'
import {
  CommunityAccessService,
  assertCommunityDatabaseAccess,
} from '../src/modules/community/community-access.service.js'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { PushRegistrationController } from '../src/modules/notifications/push-registration.controller.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({
  datasources: { db: { url: db.url } },
  log: [{ emit: 'event', level: 'query' }],
})
const databaseQueries: string[] = []
prisma.$on('query', (event) => databaseQueries.push(event.query))
const remote = { getFeatureFlagValue: vi.fn(() => Promise.resolve<unknown>(true)) }
const flags = new FeatureFlagsService(
  new FeatureFlagsRepository(prisma),
  remote,
  new CommunityFlagEvaluationService(prisma, remote)
)
const repository = new CommunityRepository(prisma)
let identityDatabase: PrismaClient = prisma
const identity = new AccessTokenIdentityService(
  new Proxy(prisma, {
    get: (target, key) =>
      key === 'user' ? identityDatabase.user : (Reflect.get(target, key) as unknown),
  })
)
const access = new CommunityAccessService(prisma, flags)
const streams = new CommunityStreamRepository(prisma)
// These routes do not invoke forecast, analytics or guardian mutation. Calls fail explicitly.
const outside = new Proxy(
  {},
  {
    get: () => {
      throw new Error('Unexpected external dependency invocation')
    },
  }
)
const storage = new InMemoryCommunityStorage()
const makeCommunity = () =>
  new CommunityService(
    repository,
    flags,
    outside as never,
    outside as never,
    storage,
    outside as never
  )
const community = makeCommunity()
let app: INestApplication
let url: string
const clients = (member: string) =>
  communitySyncClient(
    createApiClient(url, { accessToken: `test-token:guardian:${member}` })
  )
const fixture = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )

beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
  const module = await Test.createTestingModule({
    controllers: [CommunitySyncController, PushRegistrationController, UserController],
    providers: [
      { provide: UserService, useValue: new UserService(prisma) },
      {
        provide: CommunitySyncService,
        useValue: new CommunitySyncService(prisma, access, community, streams),
      },
      {
        provide: CommunityTargetsService,
        useValue: new CommunityTargetsService(prisma, access, repository, community),
      },
      {
        provide: CommunityPreferencesService,
        useValue: new CommunityPreferencesService(prisma, access),
      },
      { provide: PushRegistrationService, useValue: new PushRegistrationService(prisma) },
      {
        provide: AccessTokenIdentityService,
        useValue: identity,
      },
      {
        provide: GuardianConsentStateService,
        useValue: new GuardianConsentStateService(prisma),
      },
    ],
  }).compile()
  app = module.createNestApplication()
  app.useLogger(false)
  app.use(bindRequestContext)
  url = await listenHttpApp(app)
}, 30_000)
afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})

describe('Story 6.5 actual HTTP controllers and generated client wrappers', () => {
  it.each([false, true])(
    'erased subjects are terminally denied without restoring heads (fixture flags=%s)',
    async (fixtureFlags) => {
      const owner = await fixture()
      const client = clients(owner.id)
      const heads = await client.events('all')
      await repository.requestErasureForUser(owner.id, new Date())
      vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', String(fixtureFlags))
      vi.stubEnv('DATABASE_URL', db.url)
      await prisma.featureFlag.upsert({
        where: { key: 'community_read_enabled' },
        create: { key: 'community_read_enabled', value: true },
        update: { value: true },
      })
      try {
        for (const cursor of [heads.nextCursor, undefined, undefined]) {
          const start = performance.now()
          const response = await fetch(
            `${url}/api/v1/community/events?mode=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            {
              headers: { authorization: `Bearer test-token:guardian:${owner.id}` },
            }
          )
          expect(response.status).toBe(403)
          expect(await response.json()).toEqual({
            statusCode: 403,
            code: 'denied',
            message: 'Community account unavailable.',
          })
          const elapsedMs = performance.now() - start
          expect(elapsedMs).toBeLessThan(2000)
          console.log(
            JSON.stringify({
              evidence: 'erased-subject-http',
              fixtureFlags,
              request: cursor ? 'replay' : 'snapshot',
              status: response.status,
              elapsedMs,
            })
          )
        }
        expect(
          await prisma.communitySubject.findUnique({ where: { member_id: owner.id } })
        ).toBeNull()
        expect(
          await prisma.communityStreamHead.count({ where: { owner_id: owner.id } })
        ).toBe(0)
        expect(
          await prisma.communityFlagEvaluation.count({ where: { member_id: owner.id } })
        ).toBe(0)
      } finally {
        vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
      }
    }
  )
  it('a missing head with a surviving subject is retryable unavailable without head recreation', async () => {
    const owner = await fixture()
    await clients(owner.id).events('all')
    await prisma.communityStreamHead.deleteMany({ where: { owner_id: owner.id } })
    const response = await fetch(`${url}/api/v1/community/events?mode=all`, {
      headers: { authorization: `Bearer test-token:guardian:${owner.id}` },
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'unavailable' })
    expect(await prisma.communitySubject.count({ where: { member_id: owner.id } })).toBe(
      1
    )
    expect(
      await prisma.communityStreamHead.count({ where: { owner_id: owner.id } })
    ).toBe(0)
  })
  it.each(['post', 'reaction', 'comment', 'registration'] as const)(
    'an erased same-session member cannot restore identifying data through %s',
    async (kind) => {
      const owner = await fixture()
      const other = await fixture()
      const post = await prisma.lookbookPost.create({
        data: buildLookbookPostCreateInput(
          createLookbookPost({ userId: other.id, status: 'published' })
        ),
      })
      await repository.requestErasureForUser(owner.id, new Date())
      const eligible = (tx: Parameters<typeof assertCommunityDatabaseAccess>[0]) =>
        assertCommunityDatabaseAccess(tx, owner.id)
      if (kind === 'post')
        await expect(
          repository.createPostDraft(
            buildLookbookPostCreateInput(
              createLookbookPost({ userId: owner.id, status: 'draft' })
            )
          )
        ).rejects.toMatchObject({ status: 403 })
      else if (kind === 'reaction')
        await expect(
          repository.setReaction({
            userId: owner.id,
            postId: post.id,
            platform: 'web',
            input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
            assertEligible: eligible,
          })
        ).rejects.toMatchObject({ status: 403 })
      else if (kind === 'comment')
        await expect(
          new CommunityCommentsRepository(prisma).create({
            userId: owner.id,
            postId: post.id,
            platform: 'web',
            input: {
              body: 'Same authenticated session',
              parentId: null,
              locale: 'en-US',
              mutationId: randomUUID(),
            },
            eligible,
          })
        ).rejects.toMatchObject({ status: 403 })
      else {
        const response = await fetch(`${url}/api/v1/notifications/push-tokens`, {
          method: 'POST',
          headers: {
            authorization: `Bearer test-token:guardian:${owner.id}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token: `ExpoPushToken[fixture_${randomUUID().replaceAll('-', '')}]`,
            installationId: randomUUID(),
            platform: 'ios',
            permission: 'granted',
          }),
        })
        expect(response.status).toBe(409)
      }
      expect(
        await prisma.communitySubject.count({ where: { member_id: owner.id } })
      ).toBe(0)
      expect(
        await prisma.communityStreamHead.count({ where: { owner_id: owner.id } })
      ).toBe(0)
      expect(await prisma.lookbookPost.count({ where: { user_id: owner.id } })).toBe(0)
      expect(await prisma.communityReaction.count({ where: { user_id: owner.id } })).toBe(
        0
      )
      expect(await prisma.communityComment.count({ where: { user_id: owner.id } })).toBe(
        0
      )
      expect(await prisma.pushToken.count({ where: { user_id: owner.id } })).toBe(0)
    }
  )
  it('C1 canonical POST success codes match the wire contracts', async () => {
    const owner = await fixture()
    const headers = {
      authorization: `Bearer test-token:guardian:${owner.id}`,
      'content-type': 'application/json',
    }
    const registration = await fetch(`${url}/api/v1/notifications/push-tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        token: `ExpoPushToken[fixture_${randomUUID().replaceAll('-', '')}]`,
        installationId: randomUUID(),
        platform: 'ios',
        permission: 'granted',
      }),
    })
    expect(registration.status).toBe(200)
    const targets = await fetch(`${url}/api/v1/community/targets/resolve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targets: [{ key: 'missing', postId: randomUUID() }] }),
    })
    expect(targets.status).toBe(200)
    expect(await targets.json()).toEqual({
      data: { targets: [{ key: 'missing', status: 'unavailable' }] },
    })
  })
  it('A02 real identity outages remain HTTP503 and recover without a denial', async () => {
    const member = await fixture()
    vi.stubEnv('SUPABASE_URL', 'https://story65.identity.invalid')
    vi.stubEnv('SUPABASE_ANON_KEY', 'synthetic-key')
    const bearer = 'verified-provider-token'
    const ambiguousEmail = `ambiguous-${randomUUID()}@synthetic.test`
    await prisma.user.createMany({
      data: [{ email: ambiguousEmail }, { email: ambiguousEmail.toUpperCase() }],
    })
    let mode = '503'
    const nativeFetch = globalThis.fetch
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).startsWith('https://story65.identity.invalid')
      ) {
        if (mode === 'network')
          return Promise.reject(new TypeError('isolated connection failure'))
        if (mode === 'json')
          return Promise.resolve(new Response('<html>', { status: 200 }))
        if (mode === 'shape') return Promise.resolve(Response.json([]))
        if (mode === 'empty') return Promise.resolve(Response.json({}))
        if (mode === 'mapping' || mode === 'ambiguous')
          return Promise.resolve(
            Response.json({
              email: mode === 'mapping' ? 'unmapped@synthetic.test' : ambiguousEmail,
              email_verified: true,
            })
          )
        if (mode === 'db')
          return Promise.resolve(
            Response.json({ email: member.email, email_verified: true })
          )
        if (mode === 'ready')
          return Promise.resolve(
            Response.json({
              app_metadata: { app_user_id: member.id, app_role: 'guardian' },
            })
          )
        return Promise.resolve(Response.json({}, { status: Number(mode) }))
      }
      return nativeFetch(input, init)
    })
    const client = communitySyncClient(createApiClient(url, { accessToken: bearer }))
    const refused = new URL(db.url)
    refused.port = '1'
    refused.searchParams.set('connect_timeout', '1')
    const broken = new PrismaClient({ datasources: { db: { url: refused.toString() } } })
    try {
      for (mode of ['503', '429', 'network', 'json', 'shape', 'empty', 'db']) {
        identityDatabase = mode === 'db' ? broken : prisma
        const start = performance.now()
        await expect(client.events('all')).rejects.toMatchObject({
          response: { status: 503 },
        })
        const profileResponse = await fetch(`${url}/api/v1/user/profile`, {
          headers: { Authorization: `Bearer ${bearer}` },
        })
        expect(profileResponse.status).toBe(503)
        expect(await profileResponse.json()).toMatchObject({
          code: 'unavailable',
          retryAfterSeconds: 2,
          message: 'Access could not be verified.',
        })
        expect(performance.now() - start).toBeLessThan(2000)
      }
      identityDatabase = prisma
      for (mode of ['401', '403', 'mapping', 'ambiguous']) {
        await expect(client.events('all')).rejects.toMatchObject({
          response: { status: 401 },
        })
        await expect(
          createApiClient(url, { accessToken: bearer }).apiV1UserProfileGet()
        ).rejects.toMatchObject({ response: { status: 401 } })
      }
      mode = 'ready'
      await expect(client.events('all')).resolves.toMatchObject({ events: [] })
      await expect(
        createApiClient(url, { accessToken: bearer }).apiV1UserProfileGet()
      ).resolves.toMatchObject({ user: { id: member.id } })
    } finally {
      identityDatabase = prisma
      provider.mockRestore()
      await broken.$disconnect()
    }
  })

  it('A01 final event serialization rechecks parent visibility after final authorization', async () => {
    const owner = await fixture()
    const post = await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: owner.id, status: 'published' })
      ),
    })
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }))
      await streams.append()
    const client = clients(owner.id)
    const heads = await client.events('all')
    const data = {
      post_id: post.id,
      user_id: owner.id,
      body: 'Synthetic parent.',
      locale: 'en-US',
      platform: 'web',
      status: 'published' as const,
      published_at: new Date(),
    }
    const a = await prisma.communityComment.create({
      data: { ...data, publication_sequence: 1 },
    })
    const b = await prisma.communityComment.create({
      data: { ...data, publication_sequence: 2 },
    })
    const child = await prisma.communityComment.create({
      data: { ...data, parent_id: a.id, publication_sequence: 3 },
    })
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }))
      await streams.append()
    await expect(
      prisma.communityComment.update({
        where: { id: child.id },
        data: { parent_id: b.id },
      })
    ).rejects.toThrow()
    const backend = access.authorize.bind(access) as typeof access.authorize
    let calls = 0
    const finalAuth = vi
      .spyOn(access, 'authorize')
      .mockImplementation(async (...args) => {
        if (++calls === 2) {
          await prisma.communityComment.update({
            where: { id: a.id },
            data: { status: 'author_deleted', body: null },
          })
        }
        return backend(...args)
      })
    try {
      const replay = await client.events('all', heads.nextCursor)
      expect(
        replay.events.some((event) => 'parentId' in event && event.parentId === a.id)
      ).toBe(false)
      expect(replay.resyncRequired).toBe(true)
    } finally {
      finalAuth.mockRestore()
    }
  })

  it('A01 resolves50 actual targets with one healthy100ms signing operation inside2s', async () => {
    const owner = await fixture()
    const posts = await Promise.all(
      Array.from({ length: 50 }, () =>
        prisma.lookbookPost.create({
          data: buildLookbookPostCreateInput(
            createLookbookPost({ userId: owner.id, status: 'published' })
          ),
        })
      )
    )
    const backend = storage.signReadUrls.bind(storage) as typeof storage.signReadUrls
    const signing = vi
      .spyOn(storage, 'signReadUrls')
      .mockImplementation(async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return backend(...args)
      })
    const started = performance.now()
    try {
      const result = await clients(owner.id).resolve({
        targets: posts.map((post) => ({ key: post.id, postId: post.id })),
      })
      expect(result.targets).toHaveLength(50)
      expect(result.targets.every((target) => target.status === 'available')).toBe(true)
      expect(signing).toHaveBeenCalledTimes(1)
      expect(performance.now() - started).toBeLessThanOrEqual(2000)
      console.info(
        JSON.stringify({
          evidence: 'A01-target50',
          elapsedMs: performance.now() - started,
          signingCalls: signing.mock.calls.length,
        })
      )
    } finally {
      signing.mockRestore()
    }
  })
  it('A01 scans200 actual public/private events with batched fresh visibility and no skipped cursor', async () => {
    const owner = await fixture()
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }))
      await streams.append()
    const client = clients(owner.id)
    const heads = await client.events('all')
    const posts = await Promise.all(
      Array.from({ length: 100 }, () =>
        prisma.lookbookPost.create({
          data: buildLookbookPostCreateInput(
            createLookbookPost({ userId: owner.id, status: 'published' })
          ),
        })
      )
    )
    await prisma.communityComment.createMany({
      data: Array.from({ length: 100 }, () => ({
        post_id: posts[0]!.id,
        user_id: owner.id,
        body: 'Controlled private backlog',
        locale: 'en-US',
        platform: 'web',
        status: 'pending_screening',
      })),
    })
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }))
      await streams.append()
    databaseQueries.length = 0
    const started = performance.now()
    const result = await client.events('all', heads.nextCursor)
    expect(result.events).toHaveLength(200)
    expect(result.events.filter((event) => event.kind === 'post.published')).toHaveLength(
      100
    )
    expect(result.events.filter((event) => event.kind === 'comment.status')).toHaveLength(
      100
    )
    const visibilityQueries = databaseQueries.filter(
      (query) =>
        query.startsWith('SELECT') && /"(?:LookbookPost|CommunityComment)"/.test(query)
    ).length
    expect(visibilityQueries).toBeLessThanOrEqual(10)
    expect(performance.now() - started).toBeLessThanOrEqual(2000)
    expect((await client.events('all', result.nextCursor)).events).toEqual([])
    console.info(
      JSON.stringify({
        evidence: 'A01-events200',
        visibilityQueries,
        elapsedMs: performance.now() - started,
      })
    )
  })

  it('R03 shares the absolute HTTP deadline across identity, DB eligibility and final projection', async () => {
    const owner = await fixture()
    const post = await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: owner.id, status: 'published' })
      ),
    })
    const identityBackend = new AccessTokenIdentityService(prisma)
    const identify = vi
      .spyOn(identity, 'resolveIdentity')
      .mockImplementation(async (...args) => {
        const result = await identityBackend.resolveIdentity(...args)
        await new Promise((resolve) => setTimeout(resolve, 600))
        return result
      })
    const projectionBackend = makeCommunity()
    const project = vi
      .spyOn(community, 'projectSnapshot')
      .mockImplementation(async (...args) => {
        const result = await projectionBackend.projectSnapshot(...args)
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return result
      })
    try {
      const started = performance.now()
      const response = await fetch(`${url}/api/v1/community/targets/resolve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer test-token:guardian:${owner.id}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targets: [{ key: 'held', postId: post.id }] }),
      })
      const body: unknown = await response.json()
      const elapsedMs = performance.now() - started
      console.info(
        JSON.stringify({
          evidence: 'R03',
          boundary: 'identity-through-final-projection-HTTP',
          elapsedMs,
          status: response.status,
        })
      )
      expect(response.status).toBe(503)
      expect(body).toMatchObject({ code: 'unavailable' })
      expect(elapsedMs).toBeLessThanOrEqual(2000)
    } finally {
      identify.mockRestore()
      project.mockRestore()
    }
  }, 5000)
  it('R02 optional assist failure preserves actual HTTP snapshot access', async () => {
    const owner = await fixture()
    const assist = vi
      .spyOn(streams, 'assist')
      .mockRejectedValueOnce(new Error('optional appender unavailable'))
    try {
      expect((await clients(owner.id).events('all')).events).toEqual([])
    } finally {
      assist.mockRestore()
    }
  })

  it('R02 isolates target revision churn and freshly removes a withdrawn child', async () => {
    const owner = await fixture()
    const posts = await Promise.all(
      [0, 1].map(() =>
        prisma.lookbookPost.create({
          data: buildLookbookPostCreateInput(
            createLookbookPost({ userId: owner.id, status: 'published' })
          ),
        })
      )
    )
    const comment = await prisma.communityComment.create({
      data: {
        post_id: posts[0]!.id,
        user_id: owner.id,
        body: 'Synthetic target',
        locale: 'en-US',
        platform: 'web',
        status: 'published',
        published_at: new Date(),
        publication_sequence: 1,
      },
    })
    const projectionBackend = makeCommunity()
    const project = vi
      .spyOn(community, 'projectSnapshot')
      .mockImplementation(async (...args) => {
        const result = await projectionBackend.projectSnapshot(...args)
        if (args[0].some((post) => post.id === posts[0]!.id)) {
          await prisma.lookbookPost.update({
            where: { id: posts[0]!.id },
            data: { community_revision: { increment: 1 } },
          })
          await prisma.communityComment.update({
            where: { id: comment.id },
            data: { status: 'author_deleted', body: null },
          })
        }
        return result
      })
    try {
      const result = await clients(owner.id).resolve({
        targets: [
          { key: 'churning', postId: posts[0]!.id, commentId: comment.id },
          { key: 'stable', postId: posts[1]!.id },
        ],
      })
      expect(result.targets[0]).toMatchObject({ status: 'available', comment: null })
      expect(result.targets[1]).toMatchObject({ key: 'stable', status: 'available' })
    } finally {
      project.mockRestore()
    }
  })

  it('R02 final batch safety fences an earlier target whose image changed during a later projection', async () => {
    const owner = await fixture()
    const posts = await Promise.all(
      [0, 1].map(() =>
        prisma.lookbookPost.create({
          data: buildLookbookPostCreateInput(
            createLookbookPost({ userId: owner.id, status: 'published' })
          ),
        })
      )
    )
    const backend = makeCommunity()
    const project = vi
      .spyOn(community, 'projectSnapshot')
      .mockImplementation(async (...args) => {
        const result = await backend.projectSnapshot(...args)
        if (args[0].some((post) => post.id === posts[1]!.id))
          await prisma.lookbookPost.update({
            where: { id: posts[0]!.id },
            data: { image_object_path: 'synthetic/replaced-safe-image.jpg' },
          })
        return result
      })
    try {
      const result = await clients(owner.id).resolve({
        targets: [
          { key: 'earlier', postId: posts[0]!.id },
          { key: 'later', postId: posts[1]!.id },
        ],
      })
      expect(result.targets).toMatchObject([
        { key: 'earlier', status: 'unavailable' },
        { key: 'later', status: 'available' },
      ])
    } finally {
      project.mockRestore()
    }
  })
  it('R04 enabled-only opt-in materializes the default shared policy atomically', async () => {
    const owner = await fixture()
    await prisma.notificationPreference.deleteMany({ where: { user_id: owner.id } })
    const current = await clients(owner.id).preferences()
    await clients(owner.id).patchPreferences({
      baseRevision: current.revision,
      enabled: true,
    })
    expect(
      await prisma.notificationPreference.findUnique({ where: { user_id: owner.id } })
    ).toMatchObject({ push_enabled: true, quiet_hours_enabled: false })
  })
  it('R04 first legacy policy creation invalidates a revision captured while absent', async () => {
    const owner = await fixture()
    await prisma.notificationPreference.deleteMany({ where: { user_id: owner.id } })
    const current = await clients(owner.id).preferences()
    await prisma.notificationPreference.create({ data: { user_id: owner.id } })
    await expect(
      clients(owner.id).patchPreferences({
        baseRevision: current.revision,
        enabled: true,
      })
    ).rejects.toMatchObject({ response: { status: 409 } })
  })
  it('6.5-CONTRACT-001: preferences are default-off and stale revisions preserve current shared policy', async () => {
    const owner = await fixture()
    const client = clients(owner.id)
    const initial = await client.preferences()
    expect(initial.enabled).toBe(false)
    const enabled = await client.patchPreferences({
      baseRevision: initial.revision,
      enabled: true,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'America/New_York',
    })
    expect(enabled).toMatchObject({
      enabled: true,
      timezone: 'America/New_York',
      quietHoursEnabled: true,
    })
    await expect(
      client.patchPreferences({ baseRevision: initial.revision, enabled: false })
    ).rejects.toMatchObject({ response: { status: 409 } })
    expect(await client.preferences()).toEqual(enabled)
    expect(
      await prisma.notificationPreference.findUniqueOrThrow({
        where: { user_id: owner.id },
      })
    ).toMatchObject({ timezone: 'America/New_York', quiet_hours_enabled: true })
  })

  it('6.5-CONTRACT-002: owned registrations redact tokens, reject stale writes and isolate removal', async () => {
    const owner = await fixture()
    const other = await fixture()
    const client = clients(owner.id)
    const token = `ExpoPushToken[fixture_${randomUUID().replaceAll('-', '')}]`
    const binding = await client.register({
      installationId: randomUUID(),
      token,
      platform: 'android',
      permission: 'granted',
    })
    expect(JSON.stringify(binding)).not.toContain(token)
    expect((await client.registrations()).registrations).toEqual([binding])
    expect((await clients(other.id).registrations()).registrations).toEqual([])
    expect(
      await clients(other.id).remove(binding.registrationId, binding.bindingGeneration)
    ).toEqual({ removed: false })
    expect(
      await client.remove(binding.registrationId, binding.bindingGeneration + 1)
    ).toEqual({ removed: false })
    expect(
      await client.remove(binding.registrationId, binding.bindingGeneration)
    ).toEqual({ removed: true })
  })

  it('6.5-CONTRACT-003: bootstrap/replay cursors are authenticated-scope bound', async () => {
    const owner = await fixture()
    const other = await fixture()
    const client = clients(owner.id)
    // Earlier independent cases leave committed outboxes. A bounded append call may drain
    // only part of that backlog, so establish an empty baseline before capturing heads.
    for (
      let batch = 0;
      batch < 20 &&
      (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }));
      batch++
    )
      await streams.append()
    expect(
      await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
    ).toBe(0)
    const heads = await client.events('all')
    expect(heads.events).toEqual([])
    const post = await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: owner.id, status: 'published' })
      ),
    })
    await new CommunityStreamRepository(prisma).append()
    const replay = await client.events('all', heads.nextCursor)
    expect(replay.events).toEqual([
      expect.objectContaining({ kind: 'post.published', postId: post.id }),
    ])
    await expect(clients(other.id).events('all', heads.nextCursor)).rejects.toMatchObject(
      { response: { status: 400 } }
    )
  })

  it('6.5-CONTRACT-004: target snapshots include reactions and exact off-page reply/root locations', async () => {
    const owner = await fixture()
    const post = await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: owner.id, status: 'published' })
      ),
    })
    const rootIds: string[] = []
    for (let i = 0; i < 21; i++) {
      const row = await prisma.communityComment.create({
        data: {
          post_id: post.id,
          user_id: owner.id,
          body: 'Synthetic root.',
          locale: 'en-US',
          platform: 'web',
          status: 'published',
          published_at: new Date(),
          publication_sequence: i + 1,
        },
      })
      rootIds.push(row.id)
    }
    let last = ''
    for (let i = 0; i < 21; i++) {
      const row = await prisma.communityComment.create({
        data: {
          post_id: post.id,
          user_id: owner.id,
          parent_id: rootIds[20]!,
          body: 'Synthetic reply.',
          locale: 'en-US',
          platform: 'web',
          status: 'published',
          published_at: new Date(),
          publication_sequence: 22 + i,
        },
      })
      last = row.id
    }
    await prisma.lookbookPost.update({
      where: { id: post.id },
      data: { comment_publication_sequence: 42 },
    })
    const result = await clients(owner.id).resolve({
      targets: [
        { key: 'reply', postId: post.id, commentId: last, parentId: rootIds[20]! },
        { key: 'missing', postId: 'missing' },
      ],
    })
    const target = result.targets[0]!
    expect(target.status).toBe('available')
    if (target.status !== 'available') throw new Error('Target unexpectedly unavailable')
    expect(target).toMatchObject({
      comment: { id: last },
      parent: { id: rootIds[20] },
      threadPosition: 20,
      post: { id: post.id, reactions: { total: 0 } },
    })
    expect(target.pageCursor).toBeTruthy()
    expect(target.parentPageCursor).toBeTruthy()
    expect(result.targets[1]).toEqual({ key: 'missing', status: 'unavailable' })
  })

  it('6.5-INT-011: full guarded HTTP failure responds unavailable within two seconds', async () => {
    const owner = await fixture()
    remote.getFeatureFlagValue.mockResolvedValueOnce(undefined)
    const started = performance.now()
    const response = await fetch(`${url}/api/v1/community/events?mode=all`, {
      headers: { authorization: `Bearer test-token:guardian:${owner.id}` },
    })
    const body: unknown = await response.json()
    const elapsedMs = performance.now() - started
    console.info(
      JSON.stringify({
        evidence: '6.5-INT-011',
        boundary: 'guard-controller-response',
        elapsedMs,
      })
    )
    expect(response.status).toBe(503)
    expect(body).toMatchObject({ code: 'unavailable' })
    expect(elapsedMs).toBeLessThanOrEqual(2000)
  })
})
