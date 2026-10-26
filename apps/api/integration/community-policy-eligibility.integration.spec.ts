import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import * as contracts from '@couture/api-client/contracts/http'
import * as policy from '../src/modules/community/community-push-policy.js'
import * as telemetry from '../src/modules/community/community-operational-telemetry.js'
import * as availability from '../src/modules/community/community-availability.js'
import * as telemetryService from '../src/modules/telemetry/telemetry.service.js'
import * as accessModule from '../src/modules/community/community-access.service.js'
import * as repositoryModule from '../src/modules/community/community.repository.js'
import * as providerModule from '../src/modules/community/community-push-provider.js'
import { PrismaClient, type Prisma } from '@prisma/client'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
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
import { communitySyncClient, createApiClient } from '@couture/api-client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { bindRequestContext } from '../src/logger/request-context.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { AlertsController } from '../src/modules/alerts/alerts.controller.js'
import { AlertsService } from '../src/modules/alerts/alerts.service.js'
import { PrismaAlertsRepository } from '../src/modules/alerts/alerts.repository.js'
import { CommunitySyncController } from '../src/modules/community/community-sync.controller.js'
import { CommunitySyncService } from '../src/modules/community/community-sync.service.js'
import { CommunityTargetsService } from '../src/modules/community/community-targets.service.js'
import { CommunityPreferencesService } from '../src/modules/community/community-preferences.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'

// Opt-in negative controls execute altered source copies only; the canonical files stay unchanged.
function classes() {
  const result = {
    Send: CommunitySendGuard,
    Worker: CommunityNotificationsWorker,
    Preferences: CommunityPreferencesService,
    Alerts: PrismaAlertsRepository,
  }
  const mutation = process.env.STORY65_POLICY_MUTANT
  if (!mutation) return result
  const dependencies: Record<string, unknown> = {
    '@couture/api-client/contracts/http': contracts,
    './community-push-policy.js': policy,
    './community-operational-telemetry.js': telemetry,
    './community-availability.js': availability,
    '../telemetry/telemetry.service.js': telemetryService,
    './community-access.service.js': accessModule,
    './community.repository.js': repositoryModule,
    './community-push-provider.js': providerModule,
  }
  function load(file: string, transform: (source: string) => string) {
    const path = resolve(__dirname, `../src/modules/${file}.ts`)
    const source = readFileSync(path, 'utf8')
    const mutated = transform(source)
    expect(mutated).not.toBe(source)
    const code = transpileModule(mutated, {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
        experimentalDecorators: true,
      },
    }).outputText
    const localRequire = createRequire(path)
    const exports: Record<string, unknown> = {}
    runInNewContext(
      code,
      {
        exports,
        get Date() {
          return Date
        },
        process,
        performance,
        AbortSignal,
        AbortController,
        setTimeout,
        clearTimeout,
        require: (id: string): unknown =>
          dependencies[id] ?? (localRequire(id) as unknown),
      },
      { filename: `${path}.${mutation}-mutant` }
    )
    console.info(
      JSON.stringify({
        evidence: 'T02-policy-negative-control',
        originalSha256: createHash('sha256').update(source).digest('hex'),
        mutation,
        canonicalSourceWritten: false,
      })
    )
    return exports
  }
  const omitQuietHistory = (source: string) => {
    const pattern =
      /await tx\.communityEligibilityChange\.create\(\{\s*data: \{[^}]*reason: 'quiet_hours',\s*\},\s*\}\)/g
    expect([...source.matchAll(pattern)]).toHaveLength(1)
    return source.replace(pattern, 'void 0')
  }
  if (mutation === 'fanout-history')
    result.Worker = load('community/community-notifications.worker', omitQuietHistory)
      .CommunityNotificationsWorker as typeof CommunityNotificationsWorker
  if (mutation === 'send-history')
    result.Send = load('community/community-send-guard', omitQuietHistory)
      .CommunitySendGuard as typeof CommunitySendGuard
  if (mutation === 'write-floor') {
    result.Preferences = load('community/community-preferences.service', (source) =>
      source.replace(
        'return this.snapshot(user, tx)',
        'await tx.communityNotificationGroup.updateMany({ where: { recipient_id: user, snapshot_at: null }, data: { next_attempt_at: new Date() } }); return this.snapshot(user, tx)'
      )
    ).CommunityPreferencesService as typeof CommunityPreferencesService
    result.Alerts = load('alerts/alerts.repository', (source) =>
      source.replace(
        'return result',
        'await tx.communityNotificationGroup.updateMany({ where: { recipient_id: userId, snapshot_at: null }, data: { next_attempt_at: new Date() } }); return result'
      )
    ).PrismaAlertsRepository as typeof PrismaAlertsRepository
  }
  return result
}

const testClasses = classes()
const db = isolatedCommunityDatabase()
const actualPrisma = new PrismaClient({ datasources: { db: { url: db.url } } })
let diagnoseDispatch = false
const transactionFailures: {
  phase: string
  elapsedMs: number
  name: string
  code: string | null
  sqlState: string | null
}[] = []
const prisma = new Proxy(actualPrisma, {
  get(target, key) {
    if (key !== '$transaction') {
      const value: unknown = Reflect.get(target, key)
      return value
    }
    return async (
      work: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { timeout?: number; maxWait?: number }
    ) => {
      let phase = 'transaction'
      const started = performance.now()
      try {
        return await target.$transaction(
          async (tx) =>
            work(
              new Proxy(tx, {
                get(connection, operation) {
                  const value: unknown = Reflect.get(connection, operation)
                  if (
                    !['$executeRawUnsafe', '$executeRaw', '$queryRaw'].includes(
                      String(operation)
                    ) ||
                    typeof value !== 'function'
                  )
                    return value
                  return (...args: unknown[]) => {
                    const query = args[0]
                    const text =
                      typeof query === 'string'
                        ? query
                        : Array.isArray(query)
                          ? query.join('')
                          : ''
                    if (text.includes("transaction_timeout = '500ms'")) phase = 'claim'
                    else if (text.includes("transaction_timeout = '3s'"))
                      phase = 'authorization'
                    else if (text.includes('CommunityFlagEvaluation')) phase = 'flag'
                    const result: unknown = Reflect.apply(value, connection, args)
                    return result
                  }
                },
              })
            ),
          options
        )
      } catch (error) {
        if (diagnoseDispatch) {
          const closed = error as {
            name?: unknown
            code?: unknown
            meta?: { code?: unknown }
          }
          transactionFailures.push({
            phase,
            elapsedMs: Math.round(performance.now() - started),
            name: typeof closed.name === 'string' ? closed.name : 'unknown',
            code: typeof closed.code === 'string' ? closed.code : null,
            sqlState: typeof closed.meta?.code === 'string' ? closed.meta.code : null,
          })
        }
        throw error
      }
    }
  },
})
const remote = { getFeatureFlagValue: () => Promise.resolve(true) }
const evaluation = new CommunityFlagEvaluationService(prisma, remote)
const flags = new FeatureFlagsService(
  new FeatureFlagsRepository(prisma),
  remote,
  evaluation
)
const access = new CommunityAccessService(prisma, flags)
const provider = vi
  .fn<typeof fetch>()
  .mockImplementation(() =>
    Promise.reject(new Error('Quiet or spaced work must not send'))
  )
const sender = new testClasses.Send(
  prisma,
  evaluation,
  new CommunityPushProvider(provider)
)
const worker = new testClasses.Worker(prisma, sender)
const repository = new CommunityRepository(prisma)
const member = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
let app: INestApplication
let url: string

beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
  const unreachable = () => {
    throw new Error('Unrelated route invoked')
  }
  const module = await Test.createTestingModule({
    controllers: [CommunitySyncController, AlertsController],
    providers: [
      {
        provide: CommunityPreferencesService,
        useValue: new testClasses.Preferences(prisma, access),
      },
      // These two unrelated routes are excluded. Actual preference routes/services are composed below.
      { provide: CommunitySyncService, useValue: { events: unreachable } },
      { provide: CommunityTargetsService, useValue: { resolve: unreachable } },
      {
        provide: AlertsService,
        useValue: new AlertsService(new testClasses.Alerts(prisma)),
      },
      {
        provide: AccessTokenIdentityService,
        useValue: new AccessTokenIdentityService(prisma),
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
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
}, 30_000)
beforeEach(async () => {
  provider.mockClear()
  await prisma.communityNotificationIntent.deleteMany()
  await prisma.communityNotificationGroup.deleteMany()
})
afterEach(() => vi.useRealTimers())
afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})
async function reaction(post: string) {
  const actor = await member()
  await repository.setReaction({
    userId: actor.id,
    postId: post,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
  return prisma.communityNotificationIntent.findFirstOrThrow({
    where: { actor_id: actor.id, post_id: post },
  })
}
async function fixture(quiet = false) {
  const author = await member()
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: author.id, status: 'published' })
    ),
  })
  const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  const boundary = new Date(Math.floor(clock!.now.getTime() / 60_000) * 60_000)
  const end = new Date(boundary.getTime() + 10 * 60_000)
  const qualification = new Date(boundary.getTime() - 60_000)
  const hm = (at: Date) => at.toISOString().slice(11, 16)
  const policy = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${author.id}]::text[],ARRAY[]::text[],true)`
    await tx.communityNotificationPreference.create({
      data: { user_id: author.id, enabled: true },
    })
    return tx.notificationPreference.create({
      data: {
        user_id: author.id,
        quiet_hours_enabled: quiet,
        quiet_hours_start: hm(boundary),
        quiet_hours_end: hm(end),
        timezone: 'UTC',
      },
    })
  })
  await new PushRegistrationService(prisma).register(author.id, {
    token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
    installationId: randomUUID(),
    platform: 'ios',
    permission: 'granted',
  })
  const created = await reaction(post.id)
  // Seed the persisted qualification instant before quiet hours; policy stays unchanged thereafter.
  const intent = quiet
    ? await prisma.communityNotificationIntent.update({
        where: { id: created.id },
        data: { qualification_recorded_at: qualification },
      })
    : created
  return { author, post, policy, qualification, end, intent }
}
async function assertQuietHistory(f: Awaited<ReturnType<typeof fixture>>, group: string) {
  expect(
    await prisma.communityEligibilityChange.findMany({
      where: { group_id: group },
      orderBy: { recorded_at: 'asc' },
    })
  ).toMatchObject([
    {
      reason: 'qualified',
      policy_revision: f.policy.policy_revision,
      previous_eligible_at: f.qualification,
      eligible_at: f.qualification,
    },
    {
      reason: 'quiet_hours',
      policy_revision: f.policy.policy_revision,
      previous_eligible_at: f.qualification,
      eligible_at: f.end,
    },
  ])
  expect(
    await prisma.communityNotificationGroup.findUniqueOrThrow({ where: { id: group } })
  ).toMatchObject({
    eligible_at: f.end,
    next_attempt_at: f.end,
    expires_at: f.intent.expires_at,
  })
  expect(
    await prisma.communityNotificationIntent.findUniqueOrThrow({
      where: { id: f.intent.id },
    })
  ).toMatchObject({
    qualification_recorded_at: f.qualification,
    expires_at: f.intent.expires_at,
  })
  expect(
    await prisma.notificationPreference.findUniqueOrThrow({
      where: { user_id: f.author.id },
    })
  ).toEqual(f.policy)
  expect(provider).not.toHaveBeenCalled()
}

describe('T02 actual policy boundaries and HTTP scheduling floors', () => {
  it('fanout crossing into quiet hours records eligibility history without a policy edit', async () => {
    const f = await fixture(true)
    expect(await worker.group()).toBe(1)
    const group = await prisma.communityNotificationGroup.findFirstOrThrow({
      where: { post_id: f.post.id },
    })
    expect(group.eligible_at).toEqual(f.qualification)
    expect(await worker.fanout()).toBe(0)
    await assertQuietHistory(f, group.id)
    expect(
      await prisma.communityTokenDelivery.count({ where: { group_id: group.id } })
    ).toBe(0)
    expect(
      await prisma.communityNotificationGroup.findUniqueOrThrow({
        where: { id: group.id },
      })
    ).toMatchObject({ status: 'deferred', snapshot_at: null })
  })

  it('send authorization crossing into quiet hours records history and a proven no-call deferral', async () => {
    const f = await fixture(true)
    // The policy phase starts with a completed live flag grant. Cold acquisition has its own COMMIT fault cases.
    const grant = await evaluation.evaluate(f.author.id)
    expect(grant.value).toBe(true)
    expect(grant.validUntil).toBeGreaterThan(performance.now())
    // Fanout happens before the boundary. Send authorization uses live PostgreSQL time inside quiet hours.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(f.qualification)
    expect(await worker.group()).toBe(1)
    expect(await worker.fanout()).toBe(1)
    vi.useRealTimers()
    const delivery = await prisma.communityTokenDelivery.findFirstOrThrow({
      where: { group: { post_id: f.post.id } },
    })
    await sender.verifyRuntime()
    transactionFailures.length = 0
    diagnoseDispatch = true
    try {
      await sender.dispatch(delivery.id)
    } finally {
      diagnoseDispatch = false
      const current = await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
        select: { status: true, next_attempt_at: true },
      })
      const attempts = await prisma.communityDeliveryAttempt.findMany({
        where: { delivery_id: delivery.id },
        orderBy: { ordinal: 'asc' },
        select: { status: true, reason: true },
      })
      const [clock] = await prisma.$queryRaw<
        { now: Date; due: boolean }[]
      >`SELECT clock_timestamp() AS now, next_attempt_at <= clock_timestamp() AS due FROM "CommunityTokenDelivery" WHERE id = ${delivery.id}::uuid`
      console.info(
        JSON.stringify({
          evidence: 'T02-send-dispatch-closed',
          delivery: current,
          attempts,
          clock,
          transactionFailures,
          providerCalls: provider.mock.calls.length,
        })
      )
    }
    await assertQuietHistory(f, delivery.group_id)
    expect(
      await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      })
    ).toMatchObject({ status: 'deferred', next_attempt_at: f.end })
    expect(
      await prisma.communityDeliveryAttempt.findMany({
        where: { delivery_id: delivery.id },
      })
    ).toMatchObject([{ status: 'deferred', reason: 'no_call:quiet_hours' }])
  })

  it.each(['claim', 'persist'] as const)(
    'a500ms actual cold flag %s COMMIT crossing the400ms client budget defers without a provider call',
    async (phase) => {
      const f = await fixture(true)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(f.qualification)
      await worker.group()
      await worker.fanout()
      vi.useRealTimers()
      const delivery = await prisma.communityTokenDelivery.findFirstOrThrow({
        where: { group: { post_id: f.post.id } },
      })
      const predicate =
        phase === 'claim'
          ? 'NEW.refresh_owner IS NOT NULL AND NEW.remote_value IS NULL'
          : 'NEW.refresh_owner IS NULL AND NEW.remote_value IS NOT NULL'
      // This runs at actual PostgreSQL COMMIT, after the guarded statements have completed.
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION cc68_flag_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF ${predicate} THEN PERFORM pg_sleep(0.5); END IF; RETURN NEW; END $body$`
      )
      await prisma.$executeRawUnsafe(
        'CREATE CONSTRAINT TRIGGER cc68_flag_commit_delay AFTER UPDATE ON "CommunityFlagEvaluation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cc68_flag_commit_delay()'
      )
      transactionFailures.length = 0
      diagnoseDispatch = true
      const remoteCalls = vi.spyOn(remote, 'getFeatureFlagValue')
      try {
        await sender.dispatch(delivery.id)
        expect(transactionFailures).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ phase: 'flag', code: 'P2028' }),
          ])
        )
        expect(provider).not.toHaveBeenCalled()
        expect(remoteCalls).toHaveBeenCalledTimes(phase === 'claim' ? 0 : 1)
        expect(
          await prisma.communityDeliveryAttempt.count({
            where: { delivery_id: delivery.id },
          })
        ).toBe(0)
        const deferred = await prisma.communityTokenDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
        expect(deferred.status).toBe('deferred')
        expect(deferred.next_attempt_at.getTime()).toBeGreaterThan(Date.now())
        expect(
          (
            await prisma.communityNotificationGroup.findUniqueOrThrow({
              where: { id: delivery.group_id },
            })
          ).expires_at
        ).toEqual(f.intent.expires_at)
        console.info(
          JSON.stringify({
            evidence: 'T02-actual-cold-commit-deferral',
            phase,
            delayMs: 500,
            transactionFailures,
            attempts: 0,
            providerCalls: 0,
          })
        )
      } finally {
        diagnoseDispatch = false
        remoteCalls.mockRestore()
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER cc68_flag_commit_delay ON "CommunityFlagEvaluation"'
        )
        await prisma.$executeRawUnsafe('DROP FUNCTION cc68_flag_commit_delay()')
      }
    }
  )

  it.each(['PATCH', 'PUT'] as const)(
    '%s retains the pending 30s floor immediately and after actual fanout',
    async (method) => {
      const f = await fixture()
      await worker.group()
      expect(await worker.fanout()).toBe(1)
      const previous = await prisma.communityNotificationGroup.findFirstOrThrow({
        where: { post_id: f.post.id },
      })
      const second = await reaction(f.post.id)
      await worker.group()
      const pending = await prisma.communityNotificationGroup.findFirstOrThrow({
        where: { post_id: f.post.id, snapshot_at: null },
      })
      const floor = previous.snapshot_at!.getTime() + 30_000
      expect(pending.next_attempt_at.getTime()).toBeGreaterThanOrEqual(floor)
      const token = `test-token:guardian:${f.author.id}`
      if (method === 'PATCH') {
        const client = communitySyncClient(createApiClient(url, { accessToken: token }))
        const preferences = await client.preferences()
        const updated = await client.patchPreferences({
          baseRevision: preferences.revision,
          timezone: 'Europe/London',
        })
        expect(updated.timezone).toBe('Europe/London')
        expect(updated.revision).not.toBe(preferences.revision)
      } else {
        const response = await fetch(`${url}/api/v1/alerts/preferences`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pushEnabled: true,
            quietHoursEnabled: false,
            quietHoursStart: '22:00',
            quietHoursEnd: '07:00',
            timezone: 'Europe/London',
          }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          data: { preferences: { timezone: 'Europe/London' } },
        })
      }
      const current = () =>
        prisma.communityNotificationGroup.findUniqueOrThrow({ where: { id: pending.id } })
      expect((await current()).next_attempt_at).toEqual(pending.next_attempt_at)
      expect(
        (
          await prisma.notificationPreference.findUniqueOrThrow({
            where: { user_id: f.author.id },
          })
        ).policy_revision
      ).toBeGreaterThan(f.policy.policy_revision)
      expect(await worker.fanout()).toBe(0)
      await worker.reconcilePolicies()
      expect(await worker.fanout()).toBe(0)
      expect(Date.now()).toBeLessThan(floor)
      expect((await current()).next_attempt_at.getTime()).toBeGreaterThanOrEqual(floor)
      expect((await current()).snapshot_at).toBeNull()
      expect((await current()).expires_at).toEqual(pending.expires_at)
      expect(
        await prisma.communityTokenDelivery.count({ where: { group_id: pending.id } })
      ).toBe(0)
      expect(
        await prisma.communityNotificationIntent.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).toMatchObject({ expires_at: second.expires_at })
      expect(provider).not.toHaveBeenCalled()
    }
  )
})
