// Story 6.11 test owner: U-D-CTRL-ROLES, -ORDER, -NO-ORACLE, -IDENTITY, -HEADERS, -VALIDATION,
// -ACTIONS-KEPT, -MALFORMED and U-D-MODULE-WIRING.
// The real guards, the real identity service and the real module middleware answer over HTTP.
// Supabase is a stubbed fetch, and the decision services are doubles. No database runs here.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Logger,
  Module,
  type INestApplication,
  type MiddlewareConsumer,
} from '@nestjs/common'
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import { API_ROLES_KEY } from '../auth/security.decorators.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import { UserSessionService } from '../auth/user-session.service.js'
import { CommunityModule } from '../community/community.module.js'
import { CommunityModerationQueue } from '../community/community-moderation.queue.js'
import { COMMUNITY_SPOTLIGHT_REDIS } from '../community/community-spotlight-cache.js'
import { CommunitySpotlightService } from '../community/community-spotlight.service.js'
import { CommunityStreamRepository } from '../community/community-stream.repository.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { listenHttpApp } from '../../testing/loopback-http-app.js'
import { moderationDecisionError } from './moderation-decision-rules.js'
import { ModerationDecisionsController } from './moderation-decisions.controller.js'
import { ModerationDecisionsRepository } from './moderation-decisions.repository.js'
import { ModerationDecisionsService } from './moderation-decisions.service.js'
import { ModerationController } from './moderation.controller.js'
import { ModerationModule } from './moderation.module.js'
import { ModerationService } from './moderation.service.js'
import { ModerationQueueController } from './moderation-queue.controller.js'
import { ModerationQueueService } from './moderation-queue.service.js'
import {
  ModerationAfterCommit,
  ModerationSanctionsService,
} from './moderation-sanctions.service.js'

const CASE_PATH = '/api/v1/moderation/cases/post.p1/decisions'
const APPEAL_PATH = '/api/v1/moderation/sanctions/s1/appeal'
const decisionBody = () => ({
  action: 'resolve',
  reason: 'A real reason',
  mutationId: randomUUID(),
  expectedRevision: '0123456789abcdef',
})
const appealBody = () => ({
  status: 'requested',
  reason: 'A real reason',
  mutationId: randomUUID(),
})
const ROUTES = [
  { name: 'decision', path: CASE_PATH, body: decisionBody },
  { name: 'appeal', path: APPEAL_PATH, body: appealBody },
]

/** What Supabase answers for each bearer token. Anything else is a 401 from Supabase. */
const SUPABASE_USERS: Record<string, Record<string, unknown>> = {
  moderator: { id: 'a1', app_metadata: { app_role: 'moderator', app_user_id: 'mod-1' } },
  admin: { id: 'a2', app_metadata: { app_role: 'admin', app_user_id: 'admin-1' } },
  guardian: { id: 'a3', app_metadata: { app_role: 'guardian', app_user_id: 'guard-1' } },
  teen: { id: 'a4', app_metadata: { app_role: 'teen', app_user_id: 'teen-1' } },
  suspended: { id: 'a5', app_metadata: { app_role: 'teen', app_user_id: 'teen-gone' } },
  superuser: { id: 'a6', app_metadata: { app_role: 'superuser', app_user_id: 'su-1' } },
  // A member wrote this into their own profile. Supabase hands it back unverified.
  selfmade: {
    id: 'a7',
    email: 'member@example.test',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    user_metadata: { role: 'moderator', app_role: 'admin' },
    app_metadata: {},
  },
}

function stubSupabase() {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: { headers: { authorization: string } }) => {
      const token = init.headers.authorization.replace(/^Bearer /, '')
      const user = SUPABASE_USERS[token]
      return Promise.resolve({
        ok: Boolean(user),
        status: user ? 200 : 401,
        json: () => Promise.resolve(user ?? {}),
      })
    })
  )
}

const decisions = { decide: vi.fn(), describeCase: vi.fn() }
const sanctions = { recordAppeal: vi.fn() }
const flagValues = new Map<string, boolean | Error>()
const flags = {
  getFeatureFlag: vi.fn((key: string, _member: string) => {
    const value = flagValues.get(key) ?? true
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  }),
}
const analytics = { capture: vi.fn() }
const queue = { listCases: vi.fn(), getCase: vi.fn() }
const prisma = {
  user: { findMany: vi.fn().mockResolvedValue([{ id: 'member-1' }]) },
  userProfile: {
    findUnique: vi.fn().mockResolvedValue({
      birthdate: new Date('1985-05-05T00:00:00.000Z'),
    }),
  },
}

/** Inherits the real `configure`, so the real route list decides which paths get the header. */
@Module({
  imports: [],
  controllers: [
    ModerationController,
    ModerationQueueController,
    ModerationDecisionsController,
  ],
  providers: [
    AccessTokenIdentityService,
    RequestAuthGuard,
    RolesGuard,
    { provide: PrismaClient, useValue: prisma },
    {
      provide: GuardianConsentStateService,
      useValue: {
        canTeenAccess: (userId: string) => Promise.resolve(userId !== 'teen-gone'),
      },
    },
    { provide: FeatureFlagsService, useValue: flags },
    { provide: ModerationDecisionsService, useValue: decisions },
    { provide: ModerationSanctionsService, useValue: sanctions },
    { provide: ModerationQueueService, useValue: queue },
    { provide: ModerationService, useValue: new ModerationService(analytics as never) },
  ],
  exports: [],
})
class ControllerTestModule extends ModerationModule {
  override configure(consumer: MiddlewareConsumer): void {
    super.configure(consumer)
  }
}

let app: INestApplication
let url: string

const post = (path: string, token?: string) => {
  const call = request(url).post(path)
  return token ? call.set('Authorization', `Bearer ${token}`) : call
}

const flagReads = () => flags.getFeatureFlag.mock.calls.length
const noServiceCalled = () => {
  expect(decisions.decide).not.toHaveBeenCalled()
  expect(sanctions.recordAppeal).not.toHaveBeenCalled()
}

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [ControllerTestModule],
  }).compile()
  app = module.createNestApplication({ rawBody: true })
  app.useLogger(false)
  url = await listenHttpApp(app)
})
afterAll(() => app.close())

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://auth.test')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('TEST_ENV', '')
  vi.stubEnv('VERCEL_ENV', '')
  stubSupabase()
  flagValues.clear()
  flags.getFeatureFlag.mockClear()
  analytics.capture.mockClear()
  decisions.decide.mockReset().mockResolvedValue({ data: { applied: 'decision' } })
  sanctions.recordAppeal.mockReset().mockResolvedValue({ data: { applied: 'appeal' } })
  queue.getCase.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe.each(ROUTES)('U-D-CTRL-ROLES: $name route', ({ path, body }) => {
  it.each([
    ['guardian', 'guardian', 403],
    ['teen', 'teen', 403],
    ['consent-suspended teen', 'suspended', 403],
    ['a role a member wrote into user_metadata', 'selfmade', 403],
    ['an unknown app role', 'superuser', 401],
    ['a token Supabase refuses', 'not-a-token', 401],
  ])('refuses %s', async (_name, token, status) => {
    const response = await post(path, token).send(body())
    expect(response.status).toBe(status)
    noServiceCalled()
    expect(flagReads()).toBe(0)
  })

  it.each([
    ['no header', undefined],
    ['a Basic scheme', 'Basic bW9kOm1vZA=='],
    ['an empty bearer', 'Bearer '],
    ['a bare token', 'moderator'],
  ])('refuses %s with 401', async (_name, header) => {
    const call = request(url).post(path)
    const response = await (header ? call.set('Authorization', header) : call).send(
      body()
    )
    expect(response.status).toBe(401)
    noServiceCalled()
    expect(flagReads()).toBe(0)
  })

  it.each(['moderator', 'admin'])('lets %s through', async (token) => {
    const response = await post(path, token).send(body())
    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('data.applied')
  })

  it.each([
    ['test-token:moderator:attacker'],
    ['k6-moderator-attacker'],
    ['test-token-moderator'],
    ['test-token'],
    [
      `a.${Buffer.from(
        JSON.stringify({
          sub: 'attacker',
          role: 'moderator',
          e2e: 'couturecast-mobile-e2e',
        })
      ).toString('base64url')}.couturecast-mobile-e2e`,
    ],
  ])('closes the %s bypass in production', async (token) => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const response = await post(path, token)
      .set('x-user-id', 'attacker')
      .set('x-user-role', 'moderator')
      .send(body())
    expect(response.status).toBe(401)
    noServiceCalled()
    expect(flagReads()).toBe(0)
  })

  it('proves the bypass token is what the production check closes', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const response = await post(path, 'test-token:moderator:local-mod').send(body())
    expect(response.status).toBe(200)
  })
})

describe('U-D-CTRL-ROLES: the declarations', () => {
  const recordAction = Object.getOwnPropertyDescriptor(
    ModerationController.prototype,
    'recordAction'
  )?.value as object

  it('guards the whole controller with the auth guard and the role guard, in that order', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ModerationDecisionsController)).toEqual([
      RequestAuthGuard,
      RolesGuard,
    ])
  })

  it('declares the role set of the 6.10 read controller and of the write controller', () => {
    const roles: unknown = Reflect.getMetadata(
      API_ROLES_KEY,
      ModerationDecisionsController
    )
    expect(roles).toEqual(['moderator', 'admin'])
    expect(roles).toEqual(Reflect.getMetadata(API_ROLES_KEY, ModerationQueueController))
    expect(roles).toEqual(Reflect.getMetadata(API_ROLES_KEY, recordAction))
  })

  it('routes exactly the two POST handlers', () => {
    const routed = ['decide', 'appeal'].map((name) => {
      const handler = Object.getOwnPropertyDescriptor(
        ModerationDecisionsController.prototype,
        name
      )?.value as object
      return Reflect.getMetadata(PATH_METADATA, handler) as string
    })
    expect(routed).toEqual(['cases/:caseId/decisions', 'sanctions/:sanctionId/appeal'])
    const others = Object.getOwnPropertyNames(
      ModerationDecisionsController.prototype
    ).filter((name) => {
      const handler = Object.getOwnPropertyDescriptor(
        ModerationDecisionsController.prototype,
        name
      )?.value as object
      return Reflect.getMetadata(METHOD_METADATA, handler) !== undefined
    })
    expect(others.sort()).toEqual(['appeal', 'decide'])
  })
})

describe.each(ROUTES)('U-D-CTRL-ORDER: $name route', ({ path, body }) => {
  const invalid = { moderatorId: 'someone-else' }

  it('answers an anonymous caller 401 with a flag off and an invalid body', async () => {
    flagValues.set('moderation_decisions_enabled', false)
    const response = await post(path).send(invalid)
    expect(response.status).toBe(401)
    expect(flagReads()).toBe(0)
  })

  it('answers a guardian 403 with a flag off and an invalid body, and reads no flag', async () => {
    flagValues.set('moderation_decisions_enabled', false)
    const response = await post(path, 'guardian').send(invalid)
    expect(response.status).toBe(403)
    expect((response.body as { message: string }).message).toBe('Insufficient role')
    expect(flagReads()).toBe(0)
  })

  it('answers a moderator 503 with the decisions flag off and an invalid body', async () => {
    flagValues.set('moderation_decisions_enabled', false)
    const response = await post(path, 'moderator').send(invalid)
    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ code: 'moderation_decisions_disabled' })
    noServiceCalled()
  })

  it('names the console flag when that one is off', async () => {
    flagValues.set('moderation_console_enabled', false)
    const response = await post(path, 'moderator').send(body())
    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({ code: 'moderation_console_disabled' })
    noServiceCalled()
  })

  it.each(['moderation_console_enabled', 'moderation_decisions_enabled'])(
    'closes the route with moderation_decisions_disabled when %s cannot be read',
    async (key) => {
      flagValues.set(key, new Error('posthog and the cache both failed'))
      const response = await post(path, 'admin').send(body())
      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({ code: 'moderation_decisions_disabled' })
      expect(JSON.stringify(response.body)).not.toContain('posthog')
      noServiceCalled()
    }
  )

  it('reads both flags for the caller', async () => {
    await post(path, 'moderator').send(body())
    expect(flags.getFeatureFlag).toHaveBeenCalledWith(
      'moderation_console_enabled',
      'mod-1'
    )
    expect(flags.getFeatureFlag).toHaveBeenCalledWith(
      'moderation_decisions_enabled',
      'mod-1'
    )
  })
})

describe('U-D-CTRL-NO-ORACLE', () => {
  beforeEach(() => {
    // Past the guards, an unknown id would answer differently. These prove the guards hide that.
    const notFound = (code: 'case_not_found' | 'sanction_not_found') =>
      Promise.reject(moderationDecisionError(code))
    decisions.decide.mockImplementation((_auth: unknown, caseId: string) =>
      caseId === 'post.p1' ? Promise.resolve({ data: {} }) : notFound('case_not_found')
    )
    sanctions.recordAppeal.mockImplementation((_auth: unknown, id: string) =>
      id === 's1' ? Promise.resolve({ data: {} }) : notFound('sanction_not_found')
    )
  })

  it.each([
    [
      'decision',
      [
        CASE_PATH,
        '/api/v1/moderation/cases/post.unknown/decisions',
        '/api/v1/moderation/cases/not%20a%20case!/decisions',
      ],
    ],
    [
      'appeal',
      [
        APPEAL_PATH,
        '/api/v1/moderation/sanctions/unknown/appeal',
        '/api/v1/moderation/sanctions/%20bad%20id/appeal',
      ],
    ],
  ])('answers byte-identical 403 bodies on the %s route', async (_name, paths) => {
    for (const token of ['guardian', 'teen']) {
      const bodies = await Promise.all(
        paths.map(async (path) => {
          const response = await post(path, token).send({})
          expect(response.status).toBe(403)
          return response.text
        })
      )
      expect(new Set(bodies).size).toBe(1)
      expect(JSON.parse(bodies[0]!)).toMatchObject({ message: 'Insufficient role' })
    }
    expect(flagReads()).toBe(0)
  })

  it('shows the same 403 whatever the flags say', async () => {
    const open = await post(CASE_PATH, 'guardian').send({})
    flagValues.set('moderation_decisions_enabled', false)
    const closed = await post(CASE_PATH, 'guardian').send({})
    expect(closed.status).toBe(403)
    expect(closed.text).toBe(open.text)
  })

  it('does answer differently past the guards, which is why the guards must hold', async () => {
    const response = await post(
      '/api/v1/moderation/cases/post.unknown/decisions',
      'moderator'
    ).send(decisionBody())
    expect(response.status).toBe(404)
  })
})

describe('U-D-CTRL-IDENTITY', () => {
  it('hands the decision service only the session identity', async () => {
    const body = decisionBody()
    const response = await post(
      `${CASE_PATH}?moderatorId=forged&userId=forged`,
      'moderator'
    )
      .set('x-user-id', 'forged')
      .set('x-user-role', 'admin')
      .send(body)
    expect(response.status).toBe(200)
    expect(decisions.decide).toHaveBeenCalledTimes(1)
    expect(decisions.decide).toHaveBeenCalledWith(
      { token: 'moderator', userId: 'mod-1', role: 'moderator' },
      'post.p1',
      body
    )
  })

  it('hands the appeal service only the session identity', async () => {
    const body = appealBody()
    const response = await post(`${APPEAL_PATH}?moderatorId=forged`, 'admin')
      .set('x-user-id', 'forged')
      .send(body)
    expect(response.status).toBe(200)
    expect(sanctions.recordAppeal).toHaveBeenCalledWith(
      { token: 'admin', userId: 'admin-1', role: 'admin' },
      's1',
      body
    )
  })

  it.each(ROUTES)(
    'refuses a forged moderator in the $name body with 400',
    async (route) => {
      for (const forged of ['moderatorId', 'userId', 'role']) {
        const response = await post(route.path, 'moderator').send({
          ...route.body(),
          [forged]: 'someone-else',
        })
        expect(response.status).toBe(400)
        expect(response.body).toMatchObject({ code: 'invalid_decision' })
      }
      noServiceCalled()
    }
  )
})

describe.each(ROUTES)('U-D-CTRL-HEADERS: $name route', ({ name, path, body }) => {
  const expectPrivate = (response: request.Response) => {
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers.vary).toMatch(/Authorization/i)
  }
  const failWith = (error: unknown) => {
    const service = name === 'decision' ? decisions.decide : sanctions.recordAppeal
    service.mockRejectedValue(error)
  }

  it('marks a 200', async () => {
    const response = await post(path, 'moderator').send(body())
    expect(response.status).toBe(200)
    expectPrivate(response)
  })

  it('marks a 400', async () => {
    const response = await post(path, 'moderator').send({ unknown: true })
    expect(response.status).toBe(400)
    expectPrivate(response)
  })

  it('marks a 401', async () => {
    const response = await post(path).send(body())
    expect(response.status).toBe(401)
    expectPrivate(response)
  })

  it('marks a 403', async () => {
    const response = await post(path, 'guardian').send(body())
    expect(response.status).toBe(403)
    expectPrivate(response)
  })

  it.each([
    [404, name === 'decision' ? 'case_not_found' : 'sanction_not_found'],
    [409, 'case_conflict'],
    [503, 'audit_unavailable'],
  ] as const)('marks a %i', async (status, code) => {
    failWith(moderationDecisionError(code))
    const response = await post(path, 'moderator').send(body())
    expect(response.status).toBe(status)
    expect(response.body).toMatchObject({ code })
    expectPrivate(response)
  })

  it('marks a 503 from a closed flag', async () => {
    flagValues.set('moderation_decisions_enabled', false)
    const response = await post(path, 'moderator').send(body())
    expect(response.status).toBe(503)
    expectPrivate(response)
  })
})

describe('U-D-CTRL-VALIDATION', () => {
  it.each([
    ['an action outside the closed set', { ...decisionBody(), action: 'delete' }],
    ['a missing reason', { ...decisionBody(), reason: undefined }],
    ['a non-UUID mutation id', { ...decisionBody(), mutationId: 'DO-NOT-ECHO' }],
    ['a ban on a non-ban arm', { ...decisionBody(), ban: { kind: 'permanent' } }],
    ['an unknown key', { ...decisionBody(), note: 'DO-NOT-ECHO' }],
    ['a reason that reads as a code', { ...decisionBody(), reason: 'unsafe_class' }],
    ['a reason that reads as a marker', { ...decisionBody(), reason: 'community_ban:x' }],
    ['an array', [decisionBody()]],
  ])('refuses %s on the decision route, with no echo', async (_name, body) => {
    const response = await post(CASE_PATH, 'moderator').send(body as object)
    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      statusCode: 400,
      code: 'invalid_decision',
      message: expect.any(String) as string,
    })
    expect(response.text).not.toContain('DO-NOT-ECHO')
    expect(response.text).not.toContain('unsafe_class')
    expect(response.text).not.toContain('community_ban')
    expect(decisions.decide).not.toHaveBeenCalled()
  })

  it.each([
    ['the starting state', { ...appealBody(), status: 'not_requested' }],
    ['a step outside the closed set', { ...appealBody(), status: 'DO-NOT-ECHO' }],
    ['a missing reason', { ...appealBody(), reason: undefined }],
    ['a short reason', { ...appealBody(), reason: 'no' }],
    ['a forged actor', { ...appealBody(), moderatorId: 'DO-NOT-ECHO' }],
  ])('refuses %s on the appeal route, with no echo', async (_name, body) => {
    const response = await post(APPEAL_PATH, 'admin').send(body)
    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      statusCode: 400,
      code: 'invalid_decision',
      message: expect.any(String) as string,
    })
    expect(response.text).not.toContain('DO-NOT-ECHO')
    expect(sanctions.recordAppeal).not.toHaveBeenCalled()
  })

  it('trims the reason and hands the parsed value to the service', async () => {
    const body = { ...decisionBody(), reason: '   A real reason  ' }
    await post(CASE_PATH, 'moderator').send(body)
    expect(decisions.decide).toHaveBeenCalledWith(
      expect.anything(),
      'post.p1',
      expect.objectContaining({ reason: 'A real reason' })
    )
  })
})

describe('U-D-CTRL-ACTIONS-KEPT (G)', () => {
  const action = {
    moderatorId: 'mod-1',
    targetId: 'post-99',
    action: 'hide',
    reason: 'policy_violation',
    contentType: 'post',
    timestamp: '2026-03-04T10:00:00.000Z',
  }

  it('keeps POST /actions and its analytics event', async () => {
    const response = await post('/api/v1/moderation/actions', 'moderator').send(action)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ tracked: true })
    expect(analytics.capture).toHaveBeenCalledTimes(1)
    expect(analytics.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'mod-1',
        event: 'moderation_action',
      })
    )
  })

  it('still refuses a moderator naming another moderator on POST /actions', async () => {
    const response = await post('/api/v1/moderation/actions', 'moderator').send({
      ...action,
      moderatorId: 'someone-else',
    })
    expect(response.status).toBe(403)
    expect(analytics.capture).not.toHaveBeenCalled()
  })

  it('reads no decisions flag and adds no no-store header on POST /actions', async () => {
    const response = await post('/api/v1/moderation/actions', 'moderator').send(action)
    expect(flagReads()).toBe(0)
    expect(response.headers['cache-control']).toBeUndefined()
  })

  it('keeps GET /cases/:id a read that reaches the queue service once', async () => {
    queue.getCase.mockResolvedValue({ data: { caseId: 'post.p1' } })
    const response = await request(url)
      .get('/api/v1/moderation/cases/post.p1')
      .set('Authorization', 'Bearer moderator')
    expect(response.status).toBe(200)
    expect(queue.getCase).toHaveBeenCalledTimes(1)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(decisions.decide).not.toHaveBeenCalled()
  })

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'answers %s on /cases/:id with 404',
    async (verb) => {
      const response = await request(url)
        [verb]('/api/v1/moderation/cases/post.p1')
        .set('Authorization', 'Bearer moderator')
        .send({})
      expect(response.status).toBe(404)
      noServiceCalled()
    }
  )

  it('adds no GET on the decision or appeal paths', async () => {
    for (const path of [CASE_PATH, APPEAL_PATH]) {
      const response = await request(url)
        .get(path)
        .set('Authorization', 'Bearer moderator')
      expect(response.status).toBe(404)
    }
  })
})

describe('U-D-CTRL-MALFORMED', () => {
  const callers: [string, string | undefined][] = [
    ['anonymous', undefined],
    ['guardian', 'guardian'],
    ['moderator', 'moderator'],
  ]

  it.each(ROUTES)(
    'answers malformed JSON on the $name route with the parser 400 for every caller',
    async ({ path }) => {
      const answers = await Promise.all(
        callers.map(async ([, token]) => {
          const response = await post(path, token)
            .set('Content-Type', 'application/json')
            .send('{"action":"resolve",')
          return response
        })
      )
      for (const response of answers) {
        expect(response.status).toBe(400)
        expect(response.text).not.toMatch(
          /moderation_|case_not_found|sanction_not_found|invalid_decision|post\.p1|"resolve"/
        )
      }
      expect(new Set(answers.map((response) => response.text)).size).toBe(1)
      expect(flagReads()).toBe(0)
      noServiceCalled()
    }
  )

  it.each(ROUTES)(
    'answers an oversized body on the $name route the same for every caller',
    async ({ path }) => {
      const oversized = JSON.stringify({ reason: 'x'.repeat(200 * 1024) })
      const answers = await Promise.all(
        callers.map(([, token]) =>
          post(path, token).set('Content-Type', 'application/json').send(oversized)
        )
      )
      for (const response of answers) {
        expect(response.status).toBe(413)
        expect(response.text).not.toMatch(
          /moderation_|case_not_found|sanction_not_found|invalid_decision|xxxx/
        )
      }
      expect(new Set(answers.map((response) => response.text)).size).toBe(1)
      expect(flagReads()).toBe(0)
      noServiceCalled()
    }
  )
})

describe('U-D-MODULE-WIRING', () => {
  it('compiles the real module and injects what the after-commit steps need', async () => {
    const redis = { quit: vi.fn(), disconnect: vi.fn(), on: vi.fn() }
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [ModerationModule],
    })
      .overrideProvider(PrismaClient)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .overrideProvider(COMMUNITY_SPOTLIGHT_REDIS)
      .useValue(redis)
      .overrideProvider(CommunityModerationQueue)
      .useValue({ close: vi.fn() })
      .compile()

    const afterCommit = module.get(ModerationAfterCommit, { strict: false })
    const wired = afterCommit as unknown as {
      spotlight: unknown
      streams: unknown
      sessions: unknown
    }
    expect(wired.spotlight).toBeInstanceOf(CommunitySpotlightService)
    expect(wired.streams).toBeInstanceOf(CommunityStreamRepository)
    expect(wired.sessions).toBeInstanceOf(UserSessionService)
    expect(module.get(ModerationDecisionsService, { strict: false })).toBeInstanceOf(
      ModerationDecisionsService
    )
    expect(module.get(ModerationSanctionsService, { strict: false })).toBeInstanceOf(
      ModerationSanctionsService
    )
    expect(module.get(ModerationDecisionsRepository, { strict: false })).toBeInstanceOf(
      ModerationDecisionsRepository
    )
    expect(module.get(ModerationQueueService, { strict: false })).toBeInstanceOf(
      ModerationQueueService
    )
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ModerationModule)).toContain(
      ModerationDecisionsController
    )
  })

  it('exports from CommunityModule what the moderation module injects', () => {
    const exported = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CommunityModule
    ) as unknown[]
    expect(exported).toContain(CommunitySpotlightService)
    expect(exported).toContain(CommunityStreamRepository)
  })

  it('adds no cycle: nothing in the community module imports the moderation module', () => {
    const imported = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      CommunityModule
    ) as unknown[]
    expect(imported).not.toContain(ModerationModule)

    const communityDir = join(__dirname, '../community')
    const offenders = readdirSync(communityDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) =>
        /from\s+['"][^'"]*\/moderation\//.test(
          readFileSync(join(communityDir, file), 'utf8')
        )
      )
    expect(offenders).toEqual([])
  })
})
