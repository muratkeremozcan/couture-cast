// Story 6.14 TEA, slices 3 and 5: the read seam and the flag overrides on real Postgres.
//
// Scenario ids are the plan's (`cc614-complimentary-access-test-design.md`). The seam and
// shortcut ids the plan lists as units run here against a real database instead, so no
// assertion depends on the Prisma query shape the seam happens to use: grant reads are
// counted from the query log by table name.
import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from '@couture/config'
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
import type * as PinoConfig from '../src/logger/pino.config.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  grant,
  member,
  never,
  recordingRemote,
  revoke,
  seedFlag,
  seedMemberFlagsOff,
} from './helpers/complimentary-access-fixtures.js'
import {
  COMPLIMENTARY_ACCESS_KILL_SWITCH_SUBJECT,
  ComplimentaryAccessService,
} from '../src/modules/feature-flags/complimentary-access.service.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'

const { logLines } = vi.hoisted(() => ({ logLines: [] as string[] }))
vi.mock('../src/logger/pino.config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PinoConfig>()
  return {
    ...actual,
    createBaseLogger: (options: Parameters<typeof actual.createBaseLogger>[0] = {}) =>
      actual.createBaseLogger({
        ...options,
        env: { ...process.env, LOG_LEVEL: 'trace', PINO_PRETTY: 'false' },
        destination: { write: (line: string) => logLines.push(line) },
      }),
  }
})

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
// A second client whose query log counts grant reads by table name (TEA-16).
const counted = new PrismaClient({
  datasources: { db: { url: database.url } },
  log: [{ emit: 'event', level: 'query' }],
})
let grantReads = 0
counted.$on('query', (event) => {
  if (event.query.includes('ComplimentaryAccessGrant')) grantReads++
})

// Pinned by value, never derived from the constant under test (seeded defect S-9).
const FIVE = [
  'premium_themes_enabled',
  'color_analysis_enabled',
  'premium_planner_enabled',
  'community_write_enabled',
  'share_card_native_share_enabled',
] as const satisfies readonly FeatureFlagKey[]
const NOT_LISTED = [
  'commerce_subscription_enabled',
  'commerce_affiliate_enabled',
  'moderation_console_enabled',
  'moderation_decisions_enabled',
  'moderation_sla_monitoring_enabled',
  'moderation_history_enabled',
  'weather_alerts_enabled',
  'complimentary_access_enabled',
] as const satisfies readonly FeatureFlagKey[]

beforeAll(async () => {
  await database.migrate()
  await seedMemberFlagsOff(prisma)
}, 120_000)
afterAll(async () => {
  await prisma.$disconnect()
  await counted.$disconnect()
  await database.drop()
})
beforeEach(() => {
  logLines.length = 0
  grantReads = 0
})
afterEach(async () => {
  vi.unstubAllEnvs()
  // Each test owns its kill-switch state.
  await prisma.featureFlag.deleteMany({ where: { key: 'complimentary_access_enabled' } })
})

function seam(remote = recordingRemote(), client: PrismaClient = prisma) {
  return { remote, service: new ComplimentaryAccessService(client, remote.provider) }
}

function flags(remote = recordingRemote(), client: PrismaClient = prisma) {
  const complimentary = new ComplimentaryAccessService(client, remote.provider)
  const cache = new CommunityFlagEvaluationService(client, remote.provider, complimentary)
  return {
    remote,
    complimentary,
    cache,
    service: new FeatureFlagsService(
      new FeatureFlagsRepository(client),
      remote.provider,
      cache,
      complimentary
    ),
  }
}

/** A client whose every model and raw query throws, for the fail-closed proofs. */
const broken = new Proxy(prisma, {
  get(target, key, receiver) {
    if (key === 'then') return undefined
    if (
      typeof key === 'string' &&
      (key.startsWith('$query') || key.startsWith('$execute'))
    )
      return () => Promise.reject(new Error('database unavailable'))
    if (typeof key === 'string' && !key.startsWith('$') && !key.startsWith('_'))
      return new Proxy(
        {},
        { get: () => () => Promise.reject(new Error('database unavailable')) }
      )
    return Reflect.get(target, key, receiver) as unknown
  },
})

describe('ComplimentaryAccessService.isActive', () => {
  it('U-ISACTIVE-TRUE: an unrevoked grant with the kill switch at its default answers true', async () => {
    const id = await member(prisma)
    const control = await member(prisma)
    await grant(prisma, id)
    const { service } = seam()

    expect(await service.isActive(id)).toBe(true)
    expect(await service.isActive(control)).toBe(false)
  })

  it('U-ISACTIVE-REVOKED: a member whose only grant is revoked answers false', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    await revoke(prisma, id)

    expect(await seam().service.isActive(id)).toBe(false)
  })

  it('U-ISACTIVE-KILL: the kill switch off closes an active grant, by row and by remote', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    await seedFlag(prisma, 'complimentary_access_enabled', false)
    expect(
      await seam(
        recordingRemote({ complimentary_access_enabled: undefined })
      ).service.isActive(id)
    ).toBe(false)

    await prisma.featureFlag.deleteMany({
      where: { key: 'complimentary_access_enabled' },
    })
    expect(
      await seam(
        recordingRemote({ complimentary_access_enabled: false })
      ).service.isActive(id)
    ).toBe(false)
  })

  it('U-ISACTIVE-ORDER: a member with no grant costs no remote call', async () => {
    const id = await member(prisma)
    const remote = recordingRemote()

    expect(await seam(remote).service.isActive(id)).toBe(false)
    expect(remote.calls).toEqual([])
  })

  it('U-KILL-SUBJECT: the kill switch is asked once, for the fixed system subject, never the member', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    const remote = recordingRemote({ complimentary_access_enabled: true })

    expect(COMPLIMENTARY_ACCESS_KILL_SWITCH_SUBJECT).toBe(
      'complimentary-access-kill-switch'
    )
    expect(await seam(remote).service.isActive(id)).toBe(true)
    expect(
      remote.calls.map(({ flagKey, subjectId }) => ({ flagKey, subjectId }))
    ).toEqual([
      {
        flagKey: 'complimentary_access_enabled',
        subjectId: 'complimentary-access-kill-switch',
      },
    ])
  })

  it('U-ISACTIVE-ERROR: a failing grant read answers false and logs the closed code with no member id', async () => {
    const id = await member(prisma)
    await grant(prisma, id)

    expect(await seam(recordingRemote(), broken).service.isActive(id)).toBe(false)
    const lines = logLines.filter((line) =>
      line.includes('complimentary_access_unavailable')
    )
    expect(lines).toHaveLength(1)
    expect(logLines.join('\n')).not.toContain(id)
  })

  it('U-KILL-FALLBACK: remote undefined lets the row decide, no row means default true, a remote answer beats the row', async () => {
    const id = await member(prisma)
    await grant(prisma, id)

    expect(
      await seam(
        recordingRemote({ complimentary_access_enabled: undefined })
      ).service.isActive(id)
    ).toBe(true)
    await seedFlag(prisma, 'complimentary_access_enabled', false)
    expect(
      await seam(
        recordingRemote({ complimentary_access_enabled: undefined })
      ).service.isActive(id)
    ).toBe(false)
    expect(
      await seam(
        recordingRemote({ complimentary_access_enabled: true })
      ).service.isActive(id)
    ).toBe(true)
  })

  it('U-KILL-ROW-FAILS: remote silent and the fallback row read throwing answers false, with the cause logged and no member id', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    // The kill switch could be off in that row; a code default of true must not stand in for it.
    const failingFlagRow = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === 'featureFlag')
          return new Proxy(
            {},
            { get: () => () => Promise.reject(new Error('feature flag row unavailable')) }
          )
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const service = new ComplimentaryAccessService(
      failingFlagRow,
      recordingRemote({ complimentary_access_enabled: undefined }).provider
    )

    expect(await service.isActive(id)).toBe(false)
    expect(await service.check(id)).toBe('unavailable')
    const lines = logLines.filter((line) =>
      line.includes('complimentary_access_unavailable')
    )
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines.every((line) => /"cause":"[^"]+"/.test(line))).toBe(true)
    expect(logLines.join('\n')).not.toContain(id)
  })

  it('U-KILL-DEADLINE: a hanging kill-switch remote falls back to the row inside 600 ms', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    await seedFlag(prisma, 'complimentary_access_enabled', true)
    const { service } = seam(
      recordingRemote({ complimentary_access_enabled: () => never() })
    )

    const started = performance.now()
    expect(await service.isActive(id)).toBe(true)
    expect(performance.now() - started).toBeLessThan(600)
  })

  it('U-NO-CACHE: grant, revoke and grant again are each visible on the next call', async () => {
    const id = await member(prisma)
    const { service } = seam()

    await grant(prisma, id)
    expect(await service.isActive(id)).toBe(true)
    await revoke(prisma, id)
    expect(await service.isActive(id)).toBe(false)
    await grant(prisma, id)
    expect(await service.isActive(id)).toBe(true)
  })
})

describe('FeatureFlagsService override, six member flags false globally', () => {
  it('classifies every flag: a new flag must land in the five, community read, or the excluded list', () => {
    expect([...FEATURE_FLAG_KEYS].sort()).toEqual(
      [...FIVE, 'community_read_enabled', ...NOT_LISTED].sort()
    )
  })

  it('U-SHORTCUT-FIVE: each of the five shortcut flags opens for a grantee and stays closed for the control', async () => {
    const id = await member(prisma)
    const control = await member(prisma)
    await grant(prisma, id)
    const { service } = flags()

    for (const key of FIVE) {
      expect({ key, value: await service.getFeatureFlag(key, id) }).toEqual({
        key,
        value: true,
      })
      expect({ key, value: await service.getFeatureFlag(key, control) }).toEqual({
        key,
        value: false,
      })
    }
  })

  it('U-SHORTCUT-NOT-READ: community_read_enabled answers from the community cache, never the shortcut', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    const remote = recordingRemote()
    const complimentary = new ComplimentaryAccessService(prisma, remote.provider)
    const evaluate = vi.fn().mockResolvedValue({
      value: false,
      expiresAt: new Date(Date.now() + 60_000),
      validUntil: performance.now() + 60_000,
    })
    const cache = { evaluate } as unknown as CommunityFlagEvaluationService
    const service = new FeatureFlagsService(
      new FeatureFlagsRepository(prisma),
      remote.provider,
      cache,
      complimentary
    )

    expect(await service.getFeatureFlag('community_read_enabled', id)).toBe(false)
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it('U-SHORTCUT-OTHERS: commerce, moderation and weather flags resolve for a grantee exactly as for the control', async () => {
    const id = await member(prisma)
    const control = await member(prisma)
    await grant(prisma, id)
    for (const key of NOT_LISTED)
      if (key !== 'complimentary_access_enabled') await seedFlag(prisma, key, false)
    const { service } = flags()

    for (const key of NOT_LISTED) {
      if (key === 'complimentary_access_enabled') continue
      expect({ key, value: await service.getFeatureFlag(key, id) }).toEqual({
        key,
        value: await service.getFeatureFlag(key, control),
      })
      expect({ key, value: await service.getFeatureFlag(key, id) }).toEqual({
        key,
        value: false,
      })
    }
  })

  it('U-NO-READ-OTHER-KEYS: flags outside the five make zero grant reads', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    const { service } = flags(recordingRemote(), counted)

    grantReads = 0
    for (const key of NOT_LISTED) await service.getFeatureFlag(key, id)
    expect(grantReads).toBe(0)

    await service.getFeatureFlag('premium_themes_enabled', id)
    expect(grantReads).toBe(1)
  })

  it('U-FIXTURE-OVERRIDE / I-OVERRIDE-FIXTURE: the E2E fixture branch opens community read for a grantee only', async () => {
    const id = await member(prisma)
    const control = await member(prisma)
    await grant(prisma, id)
    vi.stubEnv('TEST_ENV', 'local')
    vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'true')
    vi.stubEnv('DATABASE_URL', database.url)
    const { service, remote } = flags()

    expect((await service.communityReadEvaluation(id)).value).toBe(true)
    expect((await service.communityReadEvaluation(control)).value).toBe(false)
    expect(
      remote.calls.filter((call) => call.flagKey === 'community_read_enabled')
    ).toEqual([])
  })

  it('I-OVERRIDE-READ / U-REFRESH-COMPLIMENTARY: the cache path opens a grantee without asking PostHog for community read', async () => {
    const id = await member(prisma)
    const control = await member(prisma)
    await grant(prisma, id)
    vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
    const { service, remote } = flags()

    expect((await service.communityReadEvaluation(id)).value).toBe(true)
    expect((await service.communityReadEvaluation(control)).value).toBe(false)
    expect(
      remote.calls
        .filter((call) => call.flagKey === 'community_read_enabled')
        .map((c) => c.subjectId)
    ).toEqual([control])
  })

  it('I-OTHER-MEMBER: a grant for one member changes no answer for another', async () => {
    const a = await member(prisma)
    const b = await member(prisma)
    const { service } = flags()
    const before: Record<string, unknown> = {}
    for (const key of FIVE) before[key] = await service.getFeatureFlag(key, b)
    before.community_read_enabled = (await service.communityReadEvaluation(b)).value

    await grant(prisma, a)
    const after: Record<string, unknown> = {}
    for (const key of FIVE) after[key] = await service.getFeatureFlag(key, b)
    after.community_read_enabled = (
      await flags().service.communityReadEvaluation(b)
    ).value

    expect(after).toEqual(before)
    expect(Object.values(after).every((value) => value === false)).toBe(true)
  })

  it('I-KILL-OFF: the kill switch off closes all six flags for a grantee', async () => {
    const id = await member(prisma)
    await grant(prisma, id)
    await seedFlag(prisma, 'complimentary_access_enabled', false)
    const { service } = flags()

    for (const key of FIVE)
      expect({ key, value: await service.getFeatureFlag(key, id) }).toEqual({
        key,
        value: false,
      })
    expect((await service.communityReadEvaluation(id)).value).toBe(false)
  })
})
