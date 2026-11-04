// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-Q-MODULE-WIRING and the response headers of the real module.
// The real ModerationModule (with CommunityModule and FeatureFlagsModule imported) is compiled,
// so a missing import or provider fails here and the cache-header middleware runs as shipped.
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { SupabaseCommunityStorageAdapter } from '../src/modules/community/community-storage.adapter.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { ModerationModule } from '../src/modules/moderation/moderation.module.js'
import { ModerationQueueService } from '../src/modules/moderation/moderation-queue.service.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { newRunId, seedMember } from './helpers/moderation-queue-seed.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasourceUrl: database.url })
const runId = newRunId()
const flags = { getFeatureFlag: vi.fn(() => Promise.resolve(true)) }
let server: string
let closeApp: () => Promise<void>
let moderatorId: string
let queueService: ModerationQueueService

beforeAll(async () => {
  await database.migrate()
  moderatorId = (await seedMember(prisma, runId, 'moderator', { alias: false })).id
  const module = await Test.createTestingModule({ imports: [ModerationModule] })
    .overrideProvider(PrismaClient)
    .useValue(prisma)
    .overrideProvider(FeatureFlagsService)
    .useValue(flags)
    .overrideProvider(SupabaseCommunityStorageAdapter)
    .useValue({ signReadUrl: vi.fn() })
    .overrideProvider(AccessTokenIdentityService)
    .useValue({
      resolveIdentity: vi.fn((token: string) => {
        const match = /^test-token:([a-z]+):(.+)$/.exec(token)
        if (!match)
          return Promise.reject(new UnauthorizedException('Invalid access token'))
        return Promise.resolve({ userId: match[2]!, role: match[1]! })
      }),
    })
    .overrideProvider(GuardianConsentStateService)
    .useValue({ canTeenAccess: vi.fn().mockResolvedValue(true) })
    .compile()
  const app = module.createNestApplication()
  app.useLogger(false)
  server = await listenHttpApp(app)
  queueService = module.get(ModerationQueueService)
  closeApp = () => app.close()
}, 120_000)

afterAll(async () => {
  try {
    await closeApp?.()
    await prisma.$disconnect()
  } finally {
    await database.drop()
  }
})

describe('U-Q-MODULE-WIRING', () => {
  it('compiles with CommunityModule and FeatureFlagsModule imported and resolves the service graph', () => {
    expect(queueService).toBeInstanceOf(ModerationQueueService)
  })

  it('serves an empty queue to a moderator through the real module', async () => {
    const response = await request(server)
      .get('/api/v1/moderation/cases')
      .set('Authorization', `Bearer test-token:moderator:${moderatorId}`)
      .expect(200)
    expect((response.body as { data: unknown }).data).toMatchObject({
      items: [],
      nextCursor: null,
    })
  })
})

describe('U-Q-CTRL-HEADERS: the shipped module marks every answer private', () => {
  const paths = ['/api/v1/moderation/cases', '/api/v1/moderation/cases/post.anything']
  it.each(paths)(
    'sets private, no-store and Vary Authorization on %s for 401, 403, 404/400 and 503',
    async (path) => {
      const get = () => request(server).get(path)
      const answers = [
        await get().expect(401),
        await get()
          .set('Authorization', 'Bearer test-token:guardian:someone')
          .expect(403),
        await get().set('Authorization', 'Bearer test-token:teen:someone').expect(403),
      ]
      const moderator = await get().set(
        'Authorization',
        `Bearer test-token:moderator:${moderatorId}`
      )
      expect([200, 404]).toContain(moderator.status)
      answers.push(moderator)
      flags.getFeatureFlag.mockResolvedValueOnce(false)
      answers.push(
        await get()
          .set('Authorization', `Bearer test-token:moderator:${moderatorId}`)
          .expect(503)
      )
      for (const answer of answers) {
        expect(answer.headers['cache-control'], `${path} ${answer.status}`).toBe(
          'private, no-store'
        )
        expect(answer.headers.vary ?? '').toMatch(/Authorization/i)
      }
    }
  )

  it('leaves the existing action route untouched by the new middleware', async () => {
    const response = await request(server).post('/api/v1/moderation/actions').send({})
    expect(response.status).toBe(401)
    expect(response.headers['cache-control'] ?? '').not.toBe('private, no-store')
  })
})
