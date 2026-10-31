// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2b: static and pure-function checks for the community worker release
// gate. The scripts under test are operations commands; what is asserted here is
// the logic that decides whether they refuse, so a regression in a refusal
// fails the ordinary suite instead of a deploy.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Queue } from 'bullmq'
import Redis, { type RedisOptions } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'
import { ownedChild } from './support/owned-child'
import { COMMUNITY_CANARY_USER_ID_PREFIX } from '../src/modules/community/community-analytics'

const repoRoot = path.resolve(__dirname, '../../..')
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')

interface CanaryModule {
  assertTargetMatchesDatabase: (target: string, url: string | undefined) => string
  assessTerminalPost: (post: Record<string, unknown>) => {
    disposition: string
    engineIdentity: string
  }
  CanaryFailure: new (...args: unknown[]) => Error & { code: string }
  withoutSslParameters: (databaseUrl: string) => string
  createDatabaseClient: (
    pg: unknown,
    options: { target: string; databaseUrl: string; ca: string | null }
  ) => { connectionParameters: { ssl: unknown; host: string } }
  recordCleanup: (
    report: Record<string, unknown>,
    cleanup: { keep: boolean; cleanup?: CleanupResult }
  ) => Record<string, unknown>
  cleanCleanup: () => CleanupResult
  outcomeUnknown: (error: unknown) => boolean
  storageOutcomeUnknown: (error: unknown) => boolean
  describeStorageError: (error: unknown) => Record<string, unknown>
  storageFetch: (signal: AbortSignal, fetchImpl: typeof fetch) => typeof fetch
  confirmWriteEnded: (
    db: { query: (sql: string, parameters?: unknown[]) => Promise<{ rows: unknown[] }> },
    session: { pid?: number | null; tag?: string },
    until: number
  ) => Promise<DatabaseWrite>
  canaryStatementTag: (ids: { postId: string }) => string
  parseCanaryArgs: (argv: string[]) => Record<string, unknown>
  soleConsumerProblems: (workers: unknown, expectedWorker: string) => string[]
  assessSoleConsumer: (
    before: unknown,
    after: unknown,
    expectedWorker: string
  ) => { proven: boolean; problems: string[] }
  liveFeedRefusal: (state: {
    codeDefault: unknown
    cachedValue?: unknown
  }) => string | null
  restartDrillProblems: (record: unknown) => string[]
  withinDeadline: <T>(
    deadlineAt: number,
    stage: string,
    work: () => Promise<T>,
    label?: string
  ) => Promise<T>
  redisOptions: (redisUrl?: string) => Record<string, unknown>
  runCanary: (options: Record<string, unknown>) => Promise<Record<string, unknown>>
  observeConsumers: (
    clients: { redis: unknown; queue: unknown },
    options: { target: string }
  ) => Promise<Record<string, unknown>>
}
interface CleanupResult {
  status: string
  problems: string[]
  unknownOutcomes: string[]
  settleMs: number | null
  databaseWrite: DatabaseWrite | null
  lateFound: string[]
  unresolved: string[]
}
interface DatabaseWrite {
  pid: number | null
  ended: boolean
  observed: string | null
  cancelRequests: number
  cancelRefused: string | null
  problem: string | null
}
interface RolloutFlagsModule {
  flagDefault: (source: string, key: string) => boolean | null
  readCommunityRolloutDefaults: (source?: string) => {
    communityReadEnabled: boolean | null
    communityWriteEnabled: boolean | null
  }
}
interface MemoryMeasureModule {
  containerServiceEnv: (env: Record<string, string>) => Record<string, string>
  containerWorkerName: (env: Record<string, string>) => { sha: string; name: string }
  requireSoleConsumerProof: (
    canary: Record<string, unknown>,
    workerName: string
  ) => Record<string, unknown>
}
interface RedisMeasureModule {
  workerClientIds: (clientList: string, workerName: string) => string[]
  presenceSample: (
    at: string,
    heartbeats: Record<string, unknown>,
    clientIds: string[],
    workerName: string
  ) => Record<string, unknown>
  summarizeWorkerPresence: (
    workerName: string,
    samples: Record<string, unknown>[]
  ) => Record<string, unknown>
}
interface HeartbeatLibModule {
  HEARTBEAT_KEY_PREFIX: string
  HEARTBEAT_KEY_PATTERN: string
  parseHeartbeatKey: (key: string) => { workerName: string; instanceId: string } | null
  readHeartbeats: (
    redis: unknown,
    options?: { count?: number; maxCalls?: number }
  ) => Promise<Record<string, unknown>>
}
interface InputSetModule {
  INPUT_DIRECTORIES: string[]
  INPUT_FILES: string[]
  WORKER_SOURCE_ENTRIES: string[]
  inputSetFiles: () => string[]
  inputSetPathspecs: () => string[]
  traceWorkerSourceGraph: () => {
    files: string[]
    unresolved: { from: string | null; specifier: string }[]
  }
}
interface LauncherModule {
  resolveStartableSelector: (env: Record<string, string>) => {
    ok: boolean
    selector?: string
    reason?: string
  }
  databaseTlsRefusal: (
    env: Record<string, string>,
    fileExists?: (file: string) => boolean
  ) => string | null
  IMAGE_DATABASE_CA: string
  SHUTDOWN_DEADLINE_MS: number
  HOST_GRACE_PERIOD_MS: number
  DRILL_ENV: Record<string, string>
  drillStartAndShutdown: (env?: Record<string, string | undefined>) => Promise<{
    started: boolean
    exitCode: number | null
    signal: string | null
    shutdowns: number
  }>
}
interface SignModule {
  signingRefusal: (context: {
    stdinIsTTY: boolean
    stdoutIsTTY: boolean
    env: Record<string, string>
    delegated?: boolean
  }) => string | null
  delegatedSignature: (
    payload: Record<string, unknown>,
    digest: string,
    now?: Date
  ) => { refusal?: string; record?: Record<string, unknown> }
  assessSignature: (
    payload: Buffer | null,
    signature: Record<string, unknown> | null
  ) => { status: string }
  payloadDigest: (bytes: Buffer) => string
  approvalRefusal: (payload: Record<string, unknown>) => string | null
}
interface CorpusModule {
  verifyManifest: (
    manifest: Record<string, unknown> | null,
    store: string
  ) => { problems: string[] }
  MINIMUM_COUNT: number
}
interface ListsModule {
  unindexableReason: (literal: string, allowSingles: Set<string>) => string | null
}

async function load<T>(relative: string): Promise<T> {
  return (await import(path.join(repoRoot, relative))) as T
}

const REAL_IDENTITY =
  'adr013-text:policy-v1@abc;adr013-nsfw-v1.0:mobilenet_v2_mid@4.3.0:model-1:v1:policy-1'

/**
 * One observation of consumers as the canary records it (Story 6.2b review,
 * RF15): the live worker heartbeats, one per worker process.
 */
function heartbeatsSeen(
  workers: { name: string; instanceId: string; problems?: string[] }[],
  extra: Record<string, unknown> = {}
) {
  return {
    source: 'heartbeat',
    known: true,
    count: workers.length,
    names: workers.map((worker) => worker.name),
    instanceIds: workers.map((worker) => worker.instanceId),
    heartbeats: workers.map((worker) => ({
      key: `community-worker:heartbeat:${worker.name}:${worker.instanceId}`,
      workerName: worker.name,
      instanceId: worker.instanceId,
      commitSha: worker.name.split('@')[1] ?? null,
      startedAt: '2026-10-17T11:00:00.000Z',
      pid: 7,
      ttlMs: 80_000,
      problems: worker.problems ?? [],
    })),
    ...extra,
  }
}

describe('community worker image', () => {
  const dockerfile = read('apps/api/Dockerfile.community-worker')

  it('runs as the unprivileged node user under tini', () => {
    expect(dockerfile).toMatch(/^USER node$/m)
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/usr\/bin\/tini", "-s", "--"\]$/m)
    expect(dockerfile).toMatch(
      /^CMD \["node", "scripts\/start-community-worker-production\.mjs"\]$/m
    )
  })

  it('fails the build past the free-tier dependency budget and self-tests the model', () => {
    expect(dockerfile).toContain('--max-node-modules-mb 150')
    expect(dockerfile).toMatch(
      /RUN COMMUNITY_NSFW_SCREENER=tensorflow node .*--self-test/
    )
  })

  it('drills the CMD start and shutdown in the build-time self-test, reaching no service', async () => {
    const { DRILL_ENV, drillStartAndShutdown } = await load<LauncherModule>(
      'scripts/start-community-worker-production.mjs'
    )
    for (const key of ['REDIS_URL', 'DATABASE_URL', 'SUPABASE_URL'])
      expect(new URL(DRILL_ENV[key]!).hostname).toBe('127.0.0.1')
    // The degraded selector stands in for the model here; the image runs it with
    // the real one.
    await expect(
      drillStartAndShutdown({
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        COMMUNITY_NSFW_SCREENER: 'unavailable',
        COMMUNITY_NSFW_INCIDENT_MODE: 'unavailable',
        COMMUNITY_NSFW_INCIDENT_REFERENCE: 'release-gate-drill',
      })
    ).resolves.toEqual({ started: true, exitCode: 0, signal: null, shutdowns: 1 })
  }, 60_000)

  it('bakes no screener selector into the image', () => {
    const envLines = dockerfile
      .split('\n')
      .filter((line) => /^\s*(ENV|\s+[A-Z_]+=)/.test(line))
    expect(envLines.join('\n')).not.toMatch(/COMMUNITY_NSFW_SCREENER=/)
  })

  it('keeps env files and installed trees out of the build context', () => {
    const ignore = read('.dockerignore')
    expect(ignore).toMatch(/^\.env\.\*$/m)
    expect(ignore).toMatch(/^!\.env\.example$/m)
    expect(ignore).toMatch(/^\*\*\/node_modules$/m)
  })
})

describe('worker database TLS', () => {
  // Story 6.2b final review (RF3): Prisma's sslmode=require encrypts without
  // verifying the server, so the image carries the Supabase CA and the
  // launcher refuses a production DATABASE_URL that does not verify against it.
  const CA_PATH = 'apps/api/certs/supabase-root-2021-ca.pem'

  it('commits the Supabase Root 2021 CA and copies it into the image', async () => {
    const { X509Certificate } = await import('node:crypto')
    const certificate = new X509Certificate(read(CA_PATH))
    expect(certificate.subject).toContain('CN=Supabase Root 2021 CA')
    expect(certificate.fingerprint256).toBe(
      '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA'
    )
    expect(new Date(certificate.validTo).toISOString()).toBe('2031-04-26T10:56:53.000Z')
    const { IMAGE_DATABASE_CA } = await load<LauncherModule>(
      'scripts/start-community-worker-production.mjs'
    )
    expect(IMAGE_DATABASE_CA).toBe(`/app/${CA_PATH}`)
    expect(read('apps/api/Dockerfile.community-worker')).toMatch(
      /^COPY --chown=root:root apps\/api\/certs\/supabase-root-2021-ca\.pem apps\/api\/certs\/$/m
    )
    expect(read('apps/api/Dockerfile.community-worker')).toMatch(/^WORKDIR \/app$/m)
  })

  it('refuses a production DATABASE_URL that would not verify the database certificate', async () => {
    const { databaseTlsRefusal, IMAGE_DATABASE_CA } = await load<LauncherModule>(
      'scripts/start-community-worker-production.mjs'
    )
    const exists = (file: string) => file === IMAGE_DATABASE_CA
    const hosted = 'postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
    const env = (query: string, NODE_ENV = 'production') => ({
      NODE_ENV,
      DATABASE_URL: `${hosted}${query}`,
    })
    const verified = `?sslmode=require&sslcert=${IMAGE_DATABASE_CA}&sslaccept=strict`

    expect(databaseTlsRefusal(env(verified), exists)).toBeNull()
    expect(databaseTlsRefusal(env('?sslmode=require'), exists)).toMatch(
      /sslaccept=strict/
    )
    expect(
      databaseTlsRefusal(env(`?sslmode=require&sslcert=${IMAGE_DATABASE_CA}`), exists)
    ).toMatch(/sslaccept=strict/)
    expect(
      databaseTlsRefusal(
        env('?sslmode=require&sslcert=/app/missing.pem&sslaccept=strict'),
        exists
      )
    ).toMatch(/does not exist/)
    expect(
      databaseTlsRefusal(env('?sslmode=require&sslcert=ca.pem&sslaccept=strict'), exists)
    ).toMatch(/absolute sslcert/)
    expect(databaseTlsRefusal(env('?sslmode=require&sslaccept=strict'), exists)).toMatch(
      /absolute sslcert/
    )
    expect(
      databaseTlsRefusal(
        env(`?sslmode=prefer&sslcert=${IMAGE_DATABASE_CA}&sslaccept=strict`),
        exists
      )
    ).toMatch(/sslmode=prefer/)
    expect(databaseTlsRefusal({ NODE_ENV: 'production' }, exists)).toMatch(/unset/)
    // A production-mode container against the laptop's own database has no TLS,
    // and outside production the launcher leaves the URL alone.
    expect(
      databaseTlsRefusal(
        {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://p:p@host.docker.internal:54322/postgres',
        },
        exists
      )
    ).toBeNull()
    expect(databaseTlsRefusal(env('?sslmode=require', 'development'), exists)).toBeNull()
  })

  it('defaults the hosted canary to the committed CA and refuses a missing one', async () => {
    const { parseCanaryArgs, COMMITTED_DATABASE_CA } = await load<
      CanaryModule & { COMMITTED_DATABASE_CA: string }
    >('scripts/community-screening-canary.mjs')
    expect(COMMITTED_DATABASE_CA).toBe(path.join(repoRoot, CA_PATH))
    expect(parseCanaryArgs(['--target', 'hosted']).dbCa).toBe(COMMITTED_DATABASE_CA)
    expect(() =>
      parseCanaryArgs(['--target', 'hosted', '--db-ca', '/absent/ca.pem'])
    ).toThrow(/does not exist/)
  })
})

describe('production launcher selector', () => {
  it('refuses an unset, unknown or fixture selector and accepts the real and degraded ones', async () => {
    const { resolveStartableSelector } = await load<LauncherModule>(
      'scripts/start-community-worker-production.mjs'
    )
    expect(resolveStartableSelector({}).ok).toBe(false)
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'fixture' }).ok).toBe(
      false
    )
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'onnx' }).ok).toBe(false)
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'tensorflow' })).toEqual({
      ok: true,
      selector: 'tensorflow',
    })
    expect(resolveStartableSelector({ COMMUNITY_NSFW_SCREENER: 'unavailable' }).ok).toBe(
      true
    )
  })
})

/**
 * The container CMD itself, against the compiled build: the launcher loads
 * `dist/src/workers/community.bootstrap.js`, starts it, and turns SIGTERM into
 * one shutdown. Every service points at a refused loopback port, so the worker
 * starts degraded and touches nothing shared. The degraded selector needs no
 * model; the image's build-time `--self-test` drills the same path with the
 * real one.
 */
describe('production launcher start and shutdown', () => {
  // Measured 2026-10-28 at load average 40 to 50: start 0.6 to 1.1 s, shutdown
  // 2.7 to 3.7 s. Bound startup plus shutdown at 50 s, with 2 s cleanup
  // inside the 60 s test budget. Test-finished cleanup also covers runner timeouts.
  const BUDGET_MS = 60_000
  it(
    'starts the compiled bootstrap and shuts it down once on SIGTERM',
    async ({ onTestFinished }) => {
      const compiled = path.join(
        repoRoot,
        'apps/api/dist/src/workers/community.bootstrap.js'
      )
      expect(fs.existsSync(compiled), `${compiled} is built by \`nest build\``).toBe(true)
      let signaled = false
      const owned = ownedChild({
        command: process.execPath,
        args: [path.join(repoRoot, 'scripts/start-community-worker-production.mjs')],
        timeoutMs: 50_000,
        onFinished: onTestFinished,
        onOutput: (output, child) => {
          if (!signaled && output.includes('Dedicated community worker started')) {
            signaled = true
            child.kill('SIGTERM')
          }
        },
        options: {
          cwd: repoRoot,
          env: {
            PATH: process.env.PATH ?? '',
            NODE_ENV: 'production',
            LOG_LEVEL: 'info',
            COMMUNITY_NSFW_SCREENER: 'unavailable',
            COMMUNITY_NSFW_INCIDENT_MODE: 'unavailable',
            COMMUNITY_NSFW_INCIDENT_REFERENCE: 'release-gate-start-shutdown',
            COMMUNITY_DISPATCH_ENABLED: 'false',
            REDIS_URL: 'redis://127.0.0.1:1',
            DATABASE_URL: 'postgresql://gate:gate@127.0.0.1:1/gate',
            SUPABASE_URL: 'http://127.0.0.1:1',
            SUPABASE_SERVICE_ROLE_KEY: 'release-gate-placeholder',
            ANALYTICS_ID_SECRET: 'release-gate-placeholder-0123456789abcdef',
          },
        },
      })
      const { code, output } = await owned.result
      const count = (text: string) => output.split(text).length - 1
      expect(signaled, output).toBe(true)
      expect(code, output).toBe(0)
      expect(count('"event":"community_worker_shutdown_requested"'), output).toBe(1)
      expect(count('Shutting down community workers'), output).toBe(1)
      expect(output).not.toMatch(/Failed to start community workers|TypeError|Unhandled/)
    },
    BUDGET_MS
  )
})

describe('owned launcher lifecycle controls', () => {
  it('reaps a startup hang at the lifecycle deadline', async ({ onTestFinished }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let ready!: () => void
    const started = new Promise<void>((resolve) => {
      ready = resolve
    })
    const owned = ownedChild({
      command: process.execPath,
      args: [
        '-e',
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("ready")',
      ],
      timeoutMs: 50_000,
      onFinished: onTestFinished,
      onOutput: (output) => {
        if (output.includes('ready')) ready()
      },
    })
    const rejected = expect(owned.result).rejects.toThrow('owned_child_lifecycle_timeout')
    try {
      await started
      vi.advanceTimersByTime(50_000)
      await rejected
      expect(owned.child.signalCode).toBe('SIGKILL')
      expect(() => process.kill(owned.child.pid!, 0)).toThrow()
    } finally {
      vi.useRealTimers()
      await owned.stop()
    }
  })

  it('reaps a hang when the runner finishes the test before the lifecycle deadline', async ({
    onTestFinished,
  }) => {
    let cleanup!: () => Promise<void>
    let ready!: () => void
    const started = new Promise<void>((resolve) => {
      ready = resolve
    })
    const owned = ownedChild({
      command: process.execPath,
      args: [
        '-e',
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("ready")',
      ],
      timeoutMs: 50_000,
      onFinished: (callback) => {
        cleanup = callback
        onTestFinished(callback)
      },
      onOutput: (output) => {
        if (output.includes('ready')) ready()
      },
    })
    try {
      await started
      await cleanup()
      expect((await owned.result).signal).toBe('SIGKILL')
      expect(() => process.kill(owned.child.pid!, 0)).toThrow()
    } finally {
      await owned.stop()
    }
  })

  it('reports a spawn error and completes cleanup without an owned PID', async ({
    onTestFinished,
  }) => {
    const owned = ownedChild({
      command: path.join(os.tmpdir(), 'cc68-missing-command', 'node'),
      args: [],
      timeoutMs: 50_000,
      onFinished: onTestFinished,
    })
    await expect(owned.result).rejects.toMatchObject({ code: 'ENOENT' })
    expect(owned.child.pid).toBeUndefined()
    await owned.stop()
  })
})

describe('shutdown budgets', () => {
  // Story 6.2b final review (RF4): the bootstrap's deadline, then the
  // launcher's, then the host's SIGKILL, each logged by the one that gives up.
  it('gives up inside the host grace period, bootstrap first', async () => {
    const { SHUTDOWN_DEADLINE_MS, HOST_GRACE_PERIOD_MS } = await load<LauncherModule>(
      'scripts/start-community-worker-production.mjs'
    )
    const bootstrap = read('apps/api/src/workers/community.bootstrap.ts')
    const bootstrapMs = Number(
      /COMMUNITY_SHUTDOWN_TIMEOUT_MS = ([\d_]+)/.exec(bootstrap)?.[1]?.replace(/_/g, '')
    )
    expect(bootstrapMs).toBe(20_000)
    expect(bootstrapMs).toBeLessThan(SHUTDOWN_DEADLINE_MS)
    expect(SHUTDOWN_DEADLINE_MS).toBeLessThan(HOST_GRACE_PERIOD_MS)
    expect(HOST_GRACE_PERIOD_MS).toBe(30_000)
    // The slow tail is documented where an operator and a maintainer look.
    expect(bootstrap).toContain('THE SLOW TAIL')
    expect(read('_bmad-output/project-knowledge/deployment-guide.md')).toContain(
      'gracePeriodSeconds'
    )
  })
})

describe('canary refusals', () => {
  it('refuses a target label that disagrees with the database host', async () => {
    const { assertTargetMatchesDatabase } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    expect(() =>
      assertTargetMatchesDatabase(
        'local',
        'postgresql://u:p@db.example.supabase.co:5432/postgres'
      )
    ).toThrow(/non-local/)
    expect(() =>
      assertTargetMatchesDatabase('hosted', 'postgresql://u:p@127.0.0.1:54322/postgres')
    ).toThrow(/local database/)
    expect(() => assertTargetMatchesDatabase('local', undefined)).toThrow(/DATABASE_URL/)
    expect(
      assertTargetMatchesDatabase('local', 'postgresql://u:p@127.0.0.1:54322/postgres')
    ).toBe('127.0.0.1')
  })

  it('fails on a fixture or degraded identity and on a withheld safe fixture', async () => {
    const { assessTerminalPost } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    const codeOf = (post: Record<string, unknown>) => {
      try {
        assessTerminalPost(post)
        return 'passed'
      } catch (error) {
        return (error as { code: string }).code
      }
    }
    expect(
      codeOf({
        status: 'published',
        moderation_engine_version: 'adr013-text-v2.0-fixture;x',
      })
    ).toBe('not_a_real_model')
    expect(
      codeOf({
        status: 'flagged',
        moderation_engine_version: 'adr013-text:p;adr013-nsfw-unavailable',
      })
    ).toBe('not_a_real_model')
    expect(codeOf({ status: 'published', moderation_engine_version: null })).toBe(
      'identity_missing'
    )
    expect(codeOf({ status: 'flagged', moderation_engine_version: REAL_IDENTITY })).toBe(
      'safe_fixture_withheld'
    )
    expect(
      assessTerminalPost({
        status: 'published',
        moderation_engine_version: REAL_IDENTITY,
      })
    ).toEqual({ disposition: 'pass', engineIdentity: REAL_IDENTITY })
  })
})

describe('hosted canary and the live feed', () => {
  it('names its account with the prefix the API keeps out of every public read', async () => {
    // Story 6.2b final review (RF8): the API's feed, single-post, card-open and
    // report reads exclude this prefix, so the two must never drift apart.
    const { CANARY_USER_ID_PREFIX } = await load<{ CANARY_USER_ID_PREFIX: string }>(
      'scripts/community-screening-canary.mjs'
    )
    expect(CANARY_USER_ID_PREFIX).toBe(COMMUNITY_CANARY_USER_ID_PREFIX)
  })

  // Story 6.2b final review (RF5): the canary's safe fixture publishes, so a
  // hosted run must not start while the feed could serve it.
  it('refuses while the feed flag defaults to anything but false or the cache holds it on', async () => {
    const { liveFeedRefusal } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    expect(liveFeedRefusal({ codeDefault: false })).toBeNull()
    expect(liveFeedRefusal({ codeDefault: false, cachedValue: false })).toBeNull()
    expect(liveFeedRefusal({ codeDefault: true })).toMatch(/defaults to true/)
    expect(liveFeedRefusal({ codeDefault: null })).toMatch(/defaults to null/)
    expect(liveFeedRefusal({ codeDefault: false, cachedValue: true })).toMatch(
      /flag cache holds community_read_enabled = true/
    )
    expect(liveFeedRefusal({ codeDefault: false, cachedValue: 'on' })).toMatch(
      /flag cache/
    )
  })

  it('reads the flag defaults the canary and the rollout gate share', async () => {
    const { flagDefault, readCommunityRolloutDefaults } = await load<RolloutFlagsModule>(
      'scripts/lib/community-rollout-flags.mjs'
    )
    const source =
      "community_read_enabled: {\n kind: 'boolean',\n defaultValue: true,\n },\ncommunity_write_enabled: { kind: 'boolean', defaultValue: false }"
    expect(flagDefault(source, 'community_read_enabled')).toBe(true)
    expect(flagDefault(source, 'community_write_enabled')).toBe(false)
    expect(flagDefault(source, 'absent_flag')).toBeNull()
    expect(readCommunityRolloutDefaults()).toMatchObject({
      communityReadEnabled: false,
      communityWriteEnabled: false,
    })
    expect(read('scripts/community-screening-canary.mjs')).toContain(
      "if (options.target === 'hosted') {\n    refuseLiveFeed("
    )
  })
})

describe('hosted canary database TLS', () => {
  // Story 6.2b peer review (CX1): pg parses the connection string after the
  // explicit `ssl` object, so `sslmode=require` dropped the CA, `no-verify`
  // turned verification off and `disable` turned TLS off.
  const ca = '-----BEGIN CERTIFICATE-----\nsupabase\n-----END CERTIFICATE-----'
  const base = 'postgresql://u:p@db.example.supabase.co:5432/postgres'

  it.each([
    ['no SSL parameter', ''],
    ['sslmode=require', '?sslmode=require'],
    ['sslmode=no-verify', '?sslmode=no-verify'],
    ['sslmode=disable', '?sslmode=disable'],
    ['ssl=false', '?ssl=false'],
    ['verify-full with a missing root cert', '?sslmode=verify-full&sslrootcert=/absent'],
  ])('verifies the certificate against the CA with %s', async (_label, query) => {
    const { createDatabaseClient } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    const pg = (await import('pg')).default
    const client = createDatabaseClient(pg, {
      target: 'hosted',
      databaseUrl: `${base}${query}`,
      ca,
    })
    expect(client.connectionParameters.ssl).toEqual({ ca, rejectUnauthorized: true })
    expect(client.connectionParameters.host).toBe('db.example.supabase.co')
  })

  it('keeps every parameter that is not an SSL override', async () => {
    const { withoutSslParameters } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    expect(
      withoutSslParameters(`${base}?sslmode=require&pgbouncer=true&SSLCERT=/x`)
    ).toBe(`${base}?pgbouncer=true`)
  })
})

describe('canary cleanup and worker identity', () => {
  it('marks a report failed when cleanup left data behind', async () => {
    // Story 6.2b peer review (CX9).
    const { recordCleanup, cleanCleanup } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    expect(recordCleanup({ ok: true }, { keep: false, cleanup: cleanCleanup() })).toEqual(
      {
        ok: true,
        cleanup: { performed: true, ...cleanCleanup() },
      }
    )
    const failed = recordCleanup(
      { ok: true },
      {
        keep: false,
        cleanup: { ...cleanCleanup(), status: 'failed', problems: ['job: gone'] },
      }
    )
    expect(failed.ok).toBe(false)
    expect(failed.code).toBe('cleanup_failed')
  })

  it('marks a report failed when cleanup cannot say whether data remains', async () => {
    // Story 6.2b final review (RF7).
    const { recordCleanup, cleanCleanup } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    const uncertain = recordCleanup(
      { ok: true },
      {
        keep: false,
        cleanup: {
          ...cleanCleanup(),
          status: 'uncertain',
          problems: ['The cleanup stage did not finish before the cleanup deadline'],
          unknownOutcomes: ['account canary-user-x', 'post canary-post-x'],
          unresolved: ['account canary-user-x', 'post canary-post-x'],
        },
      }
    )
    expect(uncertain).toMatchObject({ ok: false, code: 'cleanup_uncertain' })
    expect(uncertain.message).toMatch(/canary-user-x, post canary-post-x/)
  })

  it('treats a write the server may not have seen as having an unknown outcome', async () => {
    // Story 6.2b final review (RF7).
    const { outcomeUnknown, CanaryFailure } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    expect(outcomeUnknown(new CanaryFailure('deadline', 'cut off'))).toBe(true)
    expect(outcomeUnknown(new Error('Query read timeout'))).toBe(true)
    expect(outcomeUnknown(new Error('Command timed out'))).toBe(true)
    expect(
      outcomeUnknown(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }))
    ).toBe(true)
    // A Node socket error code can look like a SQLSTATE; only the server's
    // error carries a severity.
    expect(
      outcomeUnknown(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    ).toBe(true)
    // An upload that ended without a storage answer (Story 6.2b final review, RF11).
    expect(
      outcomeUnknown(new CanaryFailure('storage_outcome_unknown', 'fetch failed'))
    ).toBe(true)
    // The server answered: a SQLSTATE with its severity, or a storage rejection.
    expect(
      outcomeUnknown(
        Object.assign(new Error('duplicate'), { code: '23505', severity: 'ERROR' })
      )
    ).toBe(false)
    expect(outcomeUnknown(new CanaryFailure('storage_rejected', 'duplicate'))).toBe(false)
    expect(outcomeUnknown(new CanaryFailure('configuration', 'no credentials'))).toBe(
      false
    )
  })

  it('requires the named worker locally only when told which build to expect', async () => {
    // Story 6.2b peer review (CX4).
    const { parseCanaryArgs } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    expect(parseCanaryArgs(['--target', 'local']).requireProcessedBy).toBe(false)
    expect(
      parseCanaryArgs(['--target', 'local', '--expect-sha', 'abc123']).requireProcessedBy
    ).toBe(true)
    expect(parseCanaryArgs(['--target', 'hosted']).requireProcessedBy).toBe(true)
  })

  it('proves a sole consumer only from two matching single-heartbeat observations', async () => {
    // Story 6.2b second peer review (CX4b): replicas of one image share the
    // worker name, so the measured container must be the only consumer. Story
    // 6.2b review (RF15): consumers are counted from heartbeats, one per worker
    // process, because Upstash answers CLIENT LIST from one node.
    const { soleConsumerProblems, assessSoleConsumer, parseCanaryArgs } =
      await load<CanaryModule>('scripts/community-screening-canary.mjs')
    const name = 'community-worker@abc123'
    const seen = (names: string[], instanceIds = names.map((_, i) => `instance-${i}`)) =>
      heartbeatsSeen(
        names.map((worker, i) => ({ name: worker, instanceId: instanceIds[i] ?? '' }))
      )

    expect(soleConsumerProblems(seen([name]), name)).toEqual([])
    expect(soleConsumerProblems(seen([name, name]), name)).not.toEqual([])
    expect(soleConsumerProblems(seen(['community-worker@zzz']), name)).not.toEqual([])
    expect(soleConsumerProblems(seen([]), name)).not.toEqual([])
    expect(soleConsumerProblems({ ...seen([name]), known: false }, name)).not.toEqual([])
    expect(soleConsumerProblems(seen([name], ['']), name)).not.toEqual([])
    // A CLIENT LIST observation is not a heartbeat count, however it reads.
    expect(
      soleConsumerProblems(
        { known: true, count: 1, names: [`bull:Y29t:w:${name}`], clientIds: ['7'] },
        name
      )
    ).toEqual(['the observation is not a heartbeat count'])
    expect(
      soleConsumerProblems(
        heartbeatsSeen([{ name, instanceId: 'a', problems: ['the key has no TTL'] }]),
        name
      )
    ).toEqual(['the key has no TTL'])

    expect(assessSoleConsumer(seen([name]), seen([name]), name).proven).toBe(true)
    // A second replica of the same image that started while the job ran.
    expect(assessSoleConsumer(seen([name]), seen([name, name]), name).proven).toBe(false)
    // The one consumer before is not the one consumer after.
    expect(
      assessSoleConsumer(seen([name], ['a']), seen([name], ['b']), name).problems
    ).toEqual([expect.stringMatching(/instance changed from a to b/)])

    expect(parseCanaryArgs(['--target', 'local']).soleConsumer).toBe(false)
    expect(
      parseCanaryArgs(['--target', 'local', '--expect-sha', 'abc', '--sole-consumer'])
        .soleConsumer
    ).toBe(true)
    expect(parseCanaryArgs(['--target', 'hosted']).soleConsumer).toBe(true)
    expect(() => parseCanaryArgs(['--target', 'local', '--sole-consumer'])).toThrow(
      /--expect-sha/
    )
    expect(() =>
      parseCanaryArgs([
        '--target',
        'local',
        '--expect-sha',
        'abc',
        '--sole-consumer',
        '--restart-drill',
      ])
    ).toThrow(/refuses --restart-drill/)
  })

  it('refuses a memory peak without the sole-consumer proof', async () => {
    const { requireSoleConsumerProof } = await load<MemoryMeasureModule>(
      'scripts/measure-community-worker-memory.mjs'
    )
    const name = 'community-worker@abc123'
    const alone = heartbeatsSeen([{ name, instanceId: 'a' }])
    const proof = {
      proven: true,
      expectedWorker: name,
      before: alone,
      after: alone,
      problems: [],
    }
    expect(
      requireSoleConsumerProof({ soleConsumerRequired: true, soleConsumer: proof }, name)
    ).toBe(proof)
    // Story 6.2b review (RF15): a proof made from CLIENT LIST is not accepted.
    expect(() =>
      requireSoleConsumerProof(
        {
          soleConsumerRequired: true,
          soleConsumer: { ...proof, after: { known: true, count: 1 } },
        },
        name
      )
    ).toThrow(/only consumer/)
    expect(() => requireSoleConsumerProof({ processedBy: name }, name)).toThrow(
      /only consumer/
    )
    expect(() =>
      requireSoleConsumerProof(
        {
          soleConsumerRequired: true,
          soleConsumer: { proven: false, expectedWorker: name, problems: ['after: 2'] },
        },
        name
      )
    ).toThrow(/after: 2/)
    expect(() =>
      requireSoleConsumerProof(
        { soleConsumerRequired: true, soleConsumer: { ...proof, expectedWorker: 'x' } },
        name
      )
    ).toThrow(/only consumer/)
    expect(read('scripts/measure-community-worker-memory.mjs')).toContain(
      "'--sole-consumer'"
    )
  })

  it("measures memory against the container's own services and worker", async () => {
    const { containerServiceEnv, containerWorkerName } = await load<MemoryMeasureModule>(
      'scripts/measure-community-worker-memory.mjs'
    )
    expect(
      containerServiceEnv({
        DATABASE_URL: 'postgresql://p:p@host.docker.internal:54322/postgres',
        REDIS_URL: 'redis://host.docker.internal:6379',
        SUPABASE_URL: 'http://host.docker.internal:54321',
        PATH: '/usr/bin',
      })
    ).toEqual({
      DATABASE_URL: 'postgresql://p:p@127.0.0.1:54322/postgres',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SUPABASE_URL: 'http://127.0.0.1:54321',
    })
    expect(() => containerServiceEnv({ REDIS_URL: 'redis://127.0.0.1:6379' })).toThrow(
      /DATABASE_URL/
    )
    expect(containerWorkerName({ COMMUNITY_WORKER_COMMIT_SHA: 'abc123' })).toEqual({
      sha: 'abc123',
      name: 'community-worker@abc123',
    })
    expect(() => containerWorkerName({ COMMUNITY_WORKER_COMMIT_SHA: 'unset' })).toThrow(
      /COMMIT_SHA/
    )
  })

  it('records whether one idle worker process held its heartbeat at every sample', async () => {
    // Story 6.2b peer review (CX6), and review RF15: presence is the worker's
    // heartbeat; CLIENT LIST is kept beside it as a cross-check.
    const { workerClientIds, presenceSample, summarizeWorkerPresence } =
      await load<RedisMeasureModule>('scripts/measure-community-worker-redis.mjs')
    const name = 'community-worker@abc123'
    const list = `id=7 addr=1 name=bull:Y29t:w:${name} age=3\nid=8 addr=2 name= age=1\n`
    expect(workerClientIds(list, name)).toEqual(['7'])
    expect(workerClientIds(list, 'community-worker@zzz')).toEqual([])
    const at = '2026-10-17T00:00:00.000Z'
    const sample = (instances: string[], clientIds: string[] = ['7']) =>
      presenceSample(
        at,
        heartbeatsSeen([
          ...instances.map((instanceId) => ({ name, instanceId })),
          { name: 'community-worker@other', instanceId: 'z' },
        ]),
        clientIds,
        name
      )
    expect(sample(['a'])).toEqual({
      at,
      heartbeatKnown: true,
      instanceIds: ['a'],
      otherWorkers: ['community-worker@other'],
      clientIds: ['7'],
    })
    // CLIENT LIST missing the worker does not make it absent.
    expect(
      summarizeWorkerPresence(name, [sample(['a']), sample(['a'], [])])
    ).toMatchObject({
      presenceSource: 'heartbeat',
      samples: 2,
      connectedSamples: 2,
      connectedThroughout: true,
      instanceIds: ['a'],
      clientListSamples: 1,
    })
    expect(summarizeWorkerPresence(name, [sample(['a']), sample([])])).toMatchObject({
      connectedSamples: 1,
      connectedThroughout: false,
    })
    // A worker that restarted mid-window is two processes, not one idle one.
    expect(summarizeWorkerPresence(name, [sample(['a']), sample(['b'])])).toMatchObject({
      connectedSamples: 2,
      connectedThroughout: false,
      instanceIds: ['a', 'b'],
    })
    expect(
      summarizeWorkerPresence(name, [
        sample(['a']),
        presenceSample(
          at,
          { source: 'heartbeat', known: false, count: null },
          ['7'],
          name
        ),
      ])
    ).toMatchObject({ connectedSamples: 1, connectedThroughout: false })
  })
})

/**
 * The heartbeat side of a Redis (Story 6.2b review, RF15): SCAN pages through
 * the given workers' heartbeat keys one per call, and GET and PTTL answer for
 * them. `calls` counts what the read sent.
 */
function heartbeatRedis(
  workers: { name: string; instanceId: string }[],
  calls: Record<string, number> = {}
) {
  const keys = workers.map(
    (worker) => `community-worker:heartbeat:${worker.name}:${worker.instanceId}`
  )
  const count = (command: string) => {
    calls[command] = (calls[command] ?? 0) + 1
  }
  return {
    scan: (cursor: string, ...args: unknown[]) => {
      count('scan')
      expect(args.slice(0, 2)).toEqual(['MATCH', 'community-worker:heartbeat:*'])
      const index = Number(cursor)
      const next = index + 1 >= keys.length ? '0' : String(index + 1)
      return Promise.resolve([next, keys.slice(index, index + 1)])
    },
    get: (key: string) => {
      count('get')
      const worker = workers[keys.indexOf(key)]
      return Promise.resolve(
        worker
          ? JSON.stringify({
              name: worker.name,
              commitSha: worker.name.split('@')[1] ?? null,
              startedAt: '2026-10-17T11:00:00.000Z',
              pid: 7,
            })
          : null
      )
    },
    pttl: (key: string) => {
      count('pttl')
      return Promise.resolve(keys.includes(key) ? 80_000 : -2)
    },
  }
}

describe('worker heartbeat reads (RF15)', () => {
  const heartbeatLib = () =>
    load<HeartbeatLibModule>('scripts/lib/community-worker-heartbeat.mjs')

  it('reads the key the worker writes', async () => {
    const { HEARTBEAT_KEY_PREFIX, parseHeartbeatKey } = await heartbeatLib()
    const worker = await import('../src/modules/community/community-worker-heartbeat.js')
    expect(HEARTBEAT_KEY_PREFIX).toBe(worker.COMMUNITY_WORKER_HEARTBEAT_PREFIX)
    const key = worker.communityWorkerHeartbeatKey(
      'community-worker@abc123',
      '7b0c8d5e-2f1a-4c4e-9f0e-6a1b2c3d4e5f'
    )
    expect(parseHeartbeatKey(key)).toEqual({
      workerName: 'community-worker@abc123',
      instanceId: '7b0c8d5e-2f1a-4c4e-9f0e-6a1b2c3d4e5f',
    })
    expect(parseHeartbeatKey('community-worker:heartbeat:')).toBeNull()
    expect(parseHeartbeatKey('bull:community-moderation:id')).toBeNull()
  })

  it('counts live heartbeats across SCAN pages and reports what the read cost', async () => {
    const { readHeartbeats } = await heartbeatLib()
    const calls: Record<string, number> = {}
    const workers = [
      { name: 'community-worker@abc123', instanceId: 'a' },
      { name: 'community-worker@abc123', instanceId: 'b' },
    ]
    const observed = await readHeartbeats(heartbeatRedis(workers, calls))
    expect(observed).toMatchObject({
      source: 'heartbeat',
      known: true,
      count: 2,
      names: ['community-worker@abc123', 'community-worker@abc123'],
      instanceIds: ['a', 'b'],
      commands: { scan: 2, get: 2, pttl: 2 },
    })
    expect(calls).toEqual({ scan: 2, get: 2, pttl: 2 })
  })

  it('reports an unfinished or refused scan as unknown, never as a count', async () => {
    const { readHeartbeats } = await heartbeatLib()
    const workers = ['a', 'b', 'c'].map((instanceId) => ({
      name: 'community-worker@abc123',
      instanceId,
    }))
    const unfinished = await readHeartbeats(heartbeatRedis(workers), { maxCalls: 2 })
    expect(unfinished).toMatchObject({ known: false, count: null })
    expect(unfinished.note).toMatch(/did not finish/)
    const refused = await readHeartbeats({
      scan: () => Promise.reject(new Error('NOPERM')),
    })
    expect(refused).toMatchObject({ known: false, count: null })
    expect(refused.note).toMatch(/NOPERM/)
  })

  it('skips a key that expired between the scan and its read, and flags one with no TTL', async () => {
    const { readHeartbeats } = await heartbeatLib()
    const redis = {
      ...heartbeatRedis([
        { name: 'community-worker@abc123', instanceId: 'gone' },
        { name: 'community-worker@abc123', instanceId: 'forever' },
      ]),
      pttl: (key: string) => Promise.resolve(key.endsWith(':gone') ? -2 : -1),
    }
    const observed = (await readHeartbeats(redis)) as {
      count: number
      heartbeats: { instanceId: string; problems: string[] }[]
    }
    expect(observed.count).toBe(1)
    expect(observed.heartbeats).toEqual([
      expect.objectContaining({
        instanceId: 'forever',
        problems: ['the key has no TTL, so it never expires'],
      }),
    ])
  })
})

/**
 * Story 6.2b review (RF15), reproduced as measured: Upstash answers CLIENT LIST
 * from one node, so on most connections the hosted worker is not listed while
 * it is connected and consuming. These runs give the canary a Redis whose
 * CLIENT LIST shows no worker and whose heartbeats show the real one.
 */
describe('canary consumers counted from heartbeats', () => {
  const canaryModule = () => load<CanaryModule>('scripts/community-screening-canary.mjs')
  const sha = 'abc123'
  const workerName = `community-worker@${sha}`

  /** Every service the canary uses, answering as a healthy run would. */
  function healthyClients(heartbeats: { name: string; instanceId: string }[]) {
    const clientList = vi.fn(() => Promise.resolve([]))
    let removed = false
    const startedAt = Date.now()
    const job = {
      processedBy: workerName,
      timestamp: startedAt,
      processedOn: startedAt + 3,
      finishedOn: startedAt + 190,
      attemptsMade: 1,
      getState: () => Promise.resolve('completed'),
      remove: () => {
        removed = true
        return Promise.resolve()
      },
    }
    const clients = {
      abort: new AbortController(),
      redis: {
        ...heartbeatRedis(heartbeats),
        disconnect: () => undefined,
        quit: () => Promise.resolve('OK'),
      },
      db: {
        connect: () => Promise.resolve(),
        end: () => Promise.resolve(),
        connection: { stream: { destroy: () => undefined } },
        query: (sql: string) => {
          if (sql.includes('pg_backend_pid()'))
            return Promise.resolve({ rows: [{ pid: 1 }] })
          if (sql.includes('SELECT status')) {
            return Promise.resolve({
              rows: [
                {
                  status: 'published',
                  moderation_reason: null,
                  moderation_engine_version: REAL_IDENTITY,
                  published_at: new Date(),
                },
              ],
            })
          }
          return Promise.resolve({ rows: [] })
        },
      },
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ error: null }),
          remove: () => Promise.resolve({ data: [], error: null }),
          list: () => Promise.resolve({ data: [], error: null }),
        }),
      },
      queue: {
        waitUntilReady: () => Promise.resolve(),
        getWorkers: clientList,
        add: () => Promise.resolve(),
        getJob: () => Promise.resolve(removed ? null : job),
        close: () => Promise.resolve(),
      },
    }
    return { clients, clientList }
  }

  async function run(target: 'local' | 'hosted', clients: unknown) {
    const { runCanary, parseCanaryArgs } = await canaryModule()
    const options = {
      ...parseCanaryArgs([
        '--target',
        target,
        '--expect-sha',
        sha,
        ...(target === 'local' ? ['--sole-consumer'] : []),
        '--cleanup-settle-ms',
        '0',
      ]),
      openClients: () => Promise.resolve(clients),
    }
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL =
      target === 'local'
        ? 'postgresql://p:p@127.0.0.1:54322/postgres'
        : 'postgresql://u:p@db.example.supabase.co:5432/postgres'
    try {
      return await runCanary(options).then(
        (report) => ({ report, failure: null }),
        (failure: unknown) => ({
          report: null,
          failure: failure as Record<string, unknown>,
        })
      )
    } finally {
      process.env.DATABASE_URL = previous
    }
  }

  it('passes a hosted run whose CLIENT LIST misses the worker its heartbeat shows', async () => {
    const { clients, clientList } = healthyClients([
      { name: workerName, instanceId: 'a' },
    ])
    const { report, failure } = await run('hosted', clients)

    expect(failure).toBeNull()
    expect(report).toMatchObject({
      ok: true,
      target: 'hosted',
      processedBy: workerName,
      soleConsumer: { proven: true, problems: [] },
      workersConnected: { source: 'heartbeat', count: 1, clientList: null },
    })
    // A hosted run never asks CLIENT LIST: on Upstash it answers for one node.
    expect(clientList).not.toHaveBeenCalled()
  })

  it('passes a local sole-consumer run, recording CLIENT LIST as a disagreeing cross-check', async () => {
    const { clients, clientList } = healthyClients([
      { name: workerName, instanceId: 'a' },
    ])
    const { report, failure } = await run('local', clients)

    expect(failure).toBeNull()
    expect(report).toMatchObject({
      ok: true,
      soleConsumer: { proven: true },
      workersConnected: {
        source: 'heartbeat',
        count: 1,
        clientList: { known: true, count: 0 },
        clientListAgrees: false,
      },
    })
    expect(clientList).toHaveBeenCalled()
  })

  it('fails the sole-consumer proof on a second heartbeat CLIENT LIST cannot see', async () => {
    const { clients } = healthyClients([
      { name: workerName, instanceId: 'a' },
      { name: workerName, instanceId: 'b' },
    ])
    for (const target of ['hosted', 'local'] as const) {
      const { report, failure } = await run(target, clients)
      expect(report).toBeNull()
      expect(failure?.message).toMatch(/exactly one consumer heartbeat/)
      expect(failure).toMatchObject({
        code: 'worker_identity',
        details: { problems: [expect.stringMatching(/^2 consumer heartbeats/)] },
        cleanup: { performed: true, status: 'clean' },
      })
    }
  })

  it('fails worker_absent with no heartbeat, whatever CLIENT LIST says', async () => {
    const { clients } = healthyClients([])
    clients.queue.getWorkers = vi.fn(() =>
      Promise.resolve([{ name: `bull:Y29t:w:${workerName}`, id: '7' }])
    ) as unknown as typeof clients.queue.getWorkers
    const { failure } = await run('local', clients)
    expect(failure).toMatchObject({ code: 'worker_absent' })
  })
})

describe('canary deadlines', () => {
  // Story 6.2b final review (RF2): a Redis or PostgreSQL that accepts the
  // connection and never answers held the canary forever, past --timeout-ms,
  // with synthetic data already created and no failure report written.
  const canaryModule = () => load<CanaryModule>('scripts/community-screening-canary.mjs')

  async function stalledServer(): Promise<{ port: number; close: () => Promise<void> }> {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return {
      port: (server.address() as net.AddressInfo).port,
      close: () =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy()
          server.close(() => resolve())
        }),
    }
  }

  /** A storage, database and queue that answer, except where told to stall. */
  function fakeClients(stallAt: 'none' | 'enqueue' | 'getJob') {
    const never = () => new Promise<never>(() => undefined)
    const calls = {
      redisDisconnect: 0,
      streamDestroy: 0,
      aborted: false,
      deleted: [] as string[],
    }
    const abort = new AbortController()
    abort.signal.addEventListener('abort', () => {
      calls.aborted = true
    })
    const clients = {
      abort,
      redis: {
        ...heartbeatRedis([{ name: 'w', instanceId: '1' }]),
        disconnect: () => {
          calls.redisDisconnect += 1
        },
        quit: () => Promise.resolve('OK'),
      },
      db: {
        connect: () => Promise.resolve(),
        end: () => Promise.resolve(),
        query: (sql: string) => {
          if (sql.startsWith('DELETE')) calls.deleted.push(sql)
          return Promise.resolve({ rows: [] })
        },
        connection: {
          stream: {
            destroy: () => {
              calls.streamDestroy += 1
            },
          },
        },
      },
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ error: null }),
          remove: () => Promise.resolve({ error: null }),
          list: () => Promise.resolve({ data: [], error: null }),
        }),
      },
      queue: {
        waitUntilReady: () => Promise.resolve(),
        getWorkers: () => Promise.resolve([{ name: 'w', id: '1' }]),
        add: () => (stallAt === 'enqueue' ? never() : Promise.resolve()),
        getJob: () => (stallAt === 'getJob' ? never() : Promise.resolve(null)),
        close: () => Promise.resolve(),
      },
    }
    return { clients, calls }
  }

  it('rejects a stage that outlives the deadline, naming the stage', async () => {
    const { withinDeadline } = await canaryModule()
    await expect(
      withinDeadline(Date.now() + 50, 'enqueue', () => new Promise(() => undefined))
    ).rejects.toMatchObject({ code: 'deadline', details: { stage: 'enqueue' } })
    await expect(
      withinDeadline(Date.now() - 1, 'polling', () => Promise.resolve(1))
    ).rejects.toMatchObject({ code: 'deadline' })
    await expect(
      withinDeadline(Date.now() + 1000, 'x', () => Promise.resolve(7))
    ).resolves.toBe(7)
  })

  it('bounds the producer Redis and the database client', async () => {
    const { redisOptions, createDatabaseClient } = await canaryModule()
    const options = redisOptions('redis://127.0.0.1:6379')
    expect(options.maxRetriesPerRequest).toBe(2)
    expect(options.connectTimeout).toBeGreaterThan(0)
    expect(options.commandTimeout).toBeGreaterThan(0)
    const retry = options.retryStrategy as (attempt: number) => number | null
    expect(retry(1)).toBeGreaterThan(0)
    expect(retry(4)).toBeNull()
    const pg = (await import('pg')).default
    for (const target of ['local', 'hosted']) {
      const client = createDatabaseClient(pg, {
        target,
        databaseUrl: 'postgresql://u:p@db.example.supabase.co:5432/postgres',
        ca: 'ca',
      }) as unknown as {
        _connectionTimeoutMillis: number
        connectionParameters: { query_timeout: number }
      }
      expect(client._connectionTimeoutMillis).toBeGreaterThan(0)
      expect(client.connectionParameters.query_timeout).toBeGreaterThan(0)
    }
  })

  it('force-closes a stalled enqueue, cleans up on fresh clients and reports the failure', async () => {
    const { runCanary, parseCanaryArgs } = await canaryModule()
    const first = fakeClients('enqueue')
    const fresh = fakeClients('none')
    const opened: unknown[] = []
    const options = {
      ...parseCanaryArgs([
        '--target',
        'local',
        '--timeout-ms',
        '600',
        '--cleanup-timeout-ms',
        '500',
        '--cleanup-settle-ms',
        '50',
      ]),
      openClients: () => {
        opened.push(1)
        return Promise.resolve(opened.length === 1 ? first.clients : fresh.clients)
      },
    }
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://p:p@127.0.0.1:54322/postgres'
    const startedAt = Date.now()
    try {
      const failure = (await runCanary(options).then(
        () => null,
        (error: unknown) => error
      )) as { code: string; details: { stage: string }; cleanup: Record<string, unknown> }
      expect(failure).toMatchObject({ code: 'deadline', details: { stage: 'enqueue' } })
      expect(Date.now() - startedAt).toBeLessThan(3000)
      expect(first.calls).toMatchObject({
        redisDisconnect: 1,
        streamDestroy: 1,
        aborted: true,
      })
      expect(opened).toHaveLength(2)
      expect(fresh.calls.deleted).toHaveLength(2)
      // The enqueue was cut off, so its outcome is unknown: cleanup waited the
      // settle window and looked again before it called the state clean.
      expect(failure.cleanup).toMatchObject({
        performed: true,
        status: 'clean',
        problems: [],
        unknownOutcomes: [expect.stringMatching(/^job canary-post-/)],
        settleMs: 50,
        lateFound: [],
      })
    } finally {
      process.env.DATABASE_URL = previous
    }
  })

  it('bounds cleanup by its own deadline and names what may remain', async () => {
    const { runCanary, parseCanaryArgs } = await canaryModule()
    const first = fakeClients('enqueue')
    const fresh = fakeClients('getJob')
    let opened = 0
    const options = {
      ...parseCanaryArgs([
        '--target',
        'local',
        '--timeout-ms',
        '400',
        '--cleanup-timeout-ms',
        '300',
        '--cleanup-settle-ms',
        '50',
      ]),
      openClients: () => Promise.resolve(++opened === 1 ? first.clients : fresh.clients),
    }
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://p:p@127.0.0.1:54322/postgres'
    const startedAt = Date.now()
    try {
      const failure = (await runCanary(options).catch((error: unknown) => error)) as {
        code: string
        cleanup: CleanupResult & { performed: boolean }
      }
      expect(Date.now() - startedAt).toBeLessThan(3000)
      expect(failure.code).toBe('deadline')
      // The enqueue's outcome is unknown and cleanup could not finish, so the
      // state is uncertain and every resource the run attempted is named.
      expect(failure.cleanup.status).toBe('uncertain')
      expect(failure.cleanup.problems).toEqual([
        expect.stringMatching(/cleanup deadline/),
      ])
      expect(failure.cleanup.unresolved).toEqual([
        expect.stringMatching(/^job canary-post-/),
        expect.stringMatching(/^account canary-user-/),
        expect.stringMatching(/^post canary-post-/),
        expect.stringMatching(/^moderation events of post canary-post-/),
        expect.stringMatching(/^object community-images\/community\/canary-post-/),
      ])
      expect(fresh.calls.redisDisconnect).toBe(1)
    } finally {
      process.env.DATABASE_URL = previous
    }
  })

  /**
   * A PostgreSQL server as far as the canary's cleanup can see it (Story 6.2b
   * final review, RF7 and RF10). Each connection gets a server process with a
   * pid, pg_stat_activity shows what each process runs, and pg_cancel_backend
   * cancels the canary's running statement unless `cancel` is 'denied'. The
   * account INSERT reaches the server and holds its process for
   * `commitAfterMs`, then commits whether or not its client still waits, the way
   * a write already on the server outlives its client: dropping the client's
   * socket does not stop it. `deletes: 'fail'` makes every account DELETE fail
   * on a lock.
   */
  function fakeDatabaseServer(options: {
    commitAfterMs: number
    cancel: 'allowed' | 'denied'
    deletes?: 'succeed' | 'fail'
  }) {
    const accounts = new Set<string>()
    const processes = new Map<number, { state: string; query: string }>()
    const running = new Map<number, () => void>()
    const state = {
      nextPid: 4100,
      userDeletes: 0,
      firstUserDeleteAt: null as number | null,
      committedAt: null as number | null,
      cancelledAt: null as number | null,
    }
    const serverError = (message: string, code: string) =>
      Object.assign(new Error(message), { code, severity: 'ERROR' })
    const insertAccount = (pid: number, sql: string, id: string) => {
      processes.set(pid, { state: 'active', query: sql })
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          running.delete(pid)
          accounts.add(id)
          state.committedAt = Date.now()
          processes.set(pid, { state: 'idle', query: sql })
          resolve({ rows: [] })
        }, options.commitAfterMs)
        running.set(pid, () => {
          clearTimeout(timer)
          running.delete(pid)
          state.cancelledAt = Date.now()
          processes.set(pid, { state: 'idle', query: sql })
          reject(serverError('canceling statement due to user request', '57014'))
        })
      })
    }
    const database = () => {
      let pid = 0
      return {
        connect: () => Promise.resolve(),
        end: () => Promise.resolve(),
        connection: { stream: { destroy: () => undefined } },
        query: (sql: string, parameters: unknown[] = []) => {
          if (sql.includes('pg_backend_pid()')) {
            pid = state.nextPid++
            processes.set(pid, { state: 'idle', query: sql })
            return Promise.resolve({ rows: [{ pid }] })
          }
          if (sql.includes('INSERT INTO "User"')) {
            return insertAccount(pid, sql, parameters[0] as string)
          }
          if (sql.includes('pg_cancel_backend')) {
            if (options.cancel === 'denied') {
              return Promise.reject(
                serverError('permission denied to cancel query', '42501')
              )
            }
            const [target, tag] = parameters as [number, string]
            const process = processes.get(target)
            if (process && process.state !== 'idle' && process.query.startsWith(tag)) {
              running.get(target)?.()
            }
            return Promise.resolve({ rows: [{ cancelled: true }] })
          }
          if (sql.includes('pg_stat_activity')) {
            const [target, tag] = parameters as [number, string]
            const rows = [...processes]
              .filter(([id, process]) => id === target || process.query.startsWith(tag))
              .map(([id, process]) => ({ pid: id, ...process }))
            return Promise.resolve({ rows })
          }
          if (sql.startsWith('DELETE FROM "User"')) {
            state.userDeletes += 1
            state.firstUserDeleteAt ??= Date.now()
            if (options.deletes === 'fail') {
              return Promise.reject(serverError('could not obtain lock on row', '55P03'))
            }
            accounts.delete(parameters[0] as string)
            return Promise.resolve({ rows: [] })
          }
          if (sql.startsWith('SELECT id FROM "User"')) {
            const id = parameters[0] as string
            return Promise.resolve({ rows: accounts.has(id) ? [{ id }] : [] })
          }
          return Promise.resolve({ rows: [] })
        },
      }
    }
    return { accounts, state, database }
  }

  /** Runs the local canary against fakes, with the given clients in place. */
  async function runWith(
    args: { timeoutMs: number; cleanupTimeoutMs: number; settleMs: number },
    clients: (opened: number) => Record<string, unknown>
  ) {
    const { runCanary, parseCanaryArgs } = await canaryModule()
    let opened = 0
    const options = {
      ...parseCanaryArgs([
        '--target',
        'local',
        '--timeout-ms',
        String(args.timeoutMs),
        '--cleanup-timeout-ms',
        String(args.cleanupTimeoutMs),
        '--cleanup-settle-ms',
        String(args.settleMs),
      ]),
      openClients: () => Promise.resolve(clients(++opened)),
    }
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://p:p@127.0.0.1:54322/postgres'
    try {
      const failure = (await runCanary(options).catch((error: unknown) => error)) as {
        code: string
        message: string
        cause?: unknown
        details: Record<string, unknown>
        cleanup: CleanupResult & { performed: boolean }
      }
      return { failure, returnedAt: Date.now() }
    } finally {
      process.env.DATABASE_URL = previous
    }
  }

  function runAgainstDatabase(
    server: ReturnType<typeof fakeDatabaseServer>,
    args: { timeoutMs: number; cleanupTimeoutMs: number; settleMs: number }
  ) {
    const first = fakeClients('none')
    const fresh = fakeClients('none')
    return runWith(args, (opened) => ({
      ...(opened === 1 ? first.clients : fresh.clients),
      db: server.database(),
    }))
  }

  const everyCanaryResource = [
    expect.stringMatching(/^account canary-user-/),
    expect.stringMatching(/^post canary-post-/),
    expect.stringMatching(/^moderation events of post canary-post-/),
    expect.stringMatching(/^object community-images\/community\/canary-post-/),
  ]

  it('keeps cleanup uncertain while a cut-off INSERT it cannot cancel outlives the settle window', async () => {
    // Story 6.2b final review (RF10). Codex's probe: the INSERT was still on
    // the server after the settle window, the lookup found nothing, cleanup
    // reported `clean`, and the account committed afterwards.
    const server = fakeDatabaseServer({ commitAfterMs: 1500, cancel: 'denied' })
    const { failure, returnedAt } = await runAgainstDatabase(server, {
      timeoutMs: 300,
      cleanupTimeoutMs: 600,
      settleMs: 50,
    })
    expect(failure).toMatchObject({
      code: 'deadline',
      details: { stage: 'database write' },
    })
    expect(failure.cleanup.status).toBe('uncertain')
    expect(failure.cleanup.unresolved).toEqual(everyCanaryResource)
    expect(failure.cleanup.databaseWrite).toMatchObject({
      pid: 4100,
      ended: false,
      cancelRefused: 'permission denied to cancel query',
    })
    expect(failure.cleanup.databaseWrite?.problem).toMatch(
      /server process 4100 was still running it/
    )
    expect(failure.cleanup.problems).toEqual([
      expect.stringMatching(/database write was not seen to end/),
    ])
    // The report was right not to say `clean`: the account lands after it.
    expect(server.accounts.size).toBe(0)
    await vi.waitFor(() => expect(server.accounts.size).toBe(1), { timeout: 3000 })
    expect(server.state.committedAt).toBeGreaterThan(returnedAt)
  })

  it('cancels a cut-off INSERT and reconciles only once it ended', async () => {
    // Story 6.2b final review (RF10).
    const server = fakeDatabaseServer({ commitAfterMs: 1500, cancel: 'allowed' })
    const { failure } = await runAgainstDatabase(server, {
      timeoutMs: 300,
      cleanupTimeoutMs: 1200,
      settleMs: 50,
    })
    expect(failure.code).toBe('deadline')
    expect(failure.cleanup).toMatchObject({
      status: 'clean',
      problems: [],
      settleMs: null,
      unresolved: [],
      databaseWrite: {
        pid: 4100,
        ended: true,
        observed: 'process idle',
        cancelRequests: 1,
        cancelRefused: null,
      },
    })
    expect(server.state.cancelledAt).not.toBeNull()
    expect(server.state.firstUserDeleteAt).toBeGreaterThanOrEqual(
      server.state.cancelledAt as number
    )
    await new Promise((resolve) => setTimeout(resolve, 1600))
    expect(server.state.committedAt).toBeNull()
    expect(server.accounts.size).toBe(0)
  })

  it('waits for a late INSERT it cannot cancel to commit, then removes it', async () => {
    // Story 6.2b final review (RF7, RF10): the INSERT commits after the settle
    // window. Cleanup deletes nothing until the INSERT's process is idle, so
    // the DELETE runs after the commit and removes the account.
    const server = fakeDatabaseServer({ commitAfterMs: 600, cancel: 'denied' })
    const { failure } = await runAgainstDatabase(server, {
      timeoutMs: 300,
      cleanupTimeoutMs: 2000,
      settleMs: 50,
    })
    expect(failure).toMatchObject({
      code: 'deadline',
      details: { stage: 'database write' },
    })
    expect(failure.cleanup).toMatchObject({
      performed: true,
      status: 'clean',
      problems: [],
      unresolved: [],
      databaseWrite: {
        ended: true,
        observed: 'process idle',
        cancelRefused: 'permission denied to cancel query',
      },
    })
    expect(failure.cleanup.unknownOutcomes).toEqual(everyCanaryResource.slice(0, 3))
    expect(server.state.firstUserDeleteAt).toBeGreaterThanOrEqual(
      server.state.committedAt as number
    )
    expect(server.accounts.size).toBe(0)
  })

  it('reports cleanup uncertain, naming every affected id, when the late account cannot be removed', async () => {
    // Story 6.2b final review (RF7).
    const server = fakeDatabaseServer({
      commitAfterMs: 500,
      cancel: 'denied',
      deletes: 'fail',
    })
    const { failure } = await runAgainstDatabase(server, {
      timeoutMs: 300,
      cleanupTimeoutMs: 1500,
      settleMs: 50,
    })
    expect(failure.code).toBe('deadline')
    expect(server.accounts.size).toBe(1)
    expect(failure.cleanup.status).toBe('uncertain')
    expect(failure.cleanup.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/canary account: could not obtain lock/),
        expect.stringMatching(/still present after cleanup: account canary-user-/),
      ])
    )
    expect(failure.cleanup.unresolved).toEqual(everyCanaryResource)
  })

  it('sees a cut-off write end only on the process it was sent on', async () => {
    // Story 6.2b final review (RF10).
    const { confirmWriteEnded, canaryStatementTag } = await canaryModule()
    const tag = canaryStatementTag({ postId: 'canary-post-x' })
    const running = { pid: 7, state: 'active', query: `${tag} INSERT INTO "User"` }
    const confirm = (
      rows: Record<string, unknown>[],
      pid: number | null = 7,
      until = Date.now() + 1000
    ) =>
      confirmWriteEnded(
        {
          query: (sql: string) =>
            Promise.resolve({ rows: sql.includes('pg_cancel_backend') ? [] : rows }),
        },
        { pid, tag },
        until
      )
    const unconfirmed = async (record: Promise<DatabaseWrite>, problem: RegExp) => {
      const seen = await record
      expect(seen.ended).toBe(false)
      expect(seen.problem).toMatch(problem)
      return seen
    }
    await unconfirmed(confirm([], null), /no server process was recorded/)
    await expect(confirm([])).resolves.toMatchObject({
      ended: true,
      observed: 'process gone',
    })
    await expect(
      confirm([{ pid: 7, state: 'active', query: 'SELECT 1' }])
    ).resolves.toMatchObject({
      ended: true,
      observed: 'process running another statement',
    })
    await unconfirmed(
      confirm([{ pid: 7, state: 'active', query: '<insufficient privilege>' }]),
      /does not show what server process 7 runs/
    )
    // A transaction pooler ran the canary's write on another process.
    await unconfirmed(
      confirm([
        { pid: 7, state: 'idle', query: 'SELECT 1' },
        { ...running, pid: 9 },
      ]),
      /runs on server process 9, not the recorded 7/
    )
    const outlasting = await unconfirmed(
      confirm([running], 7, Date.now() + 250),
      /still running it \(active\)/
    )
    expect(outlasting.cancelRequests).toBeGreaterThan(0)
  })

  /**
   * The storage server behind the real storage-js client, reached through the
   * canary's own storage fetch (Story 6.2b final review, RF11). In
   * 'lost-connection' mode the upload reaches the server and the connection
   * then fails, so the client sees a transport error while the server writes
   * the object `commitAfterMs` later. In 'rejected' mode the server refuses the
   * upload with its error body.
   */
  function fakeStorageServer(options: {
    upload: 'lost-connection' | 'rejected'
    commitAfterMs?: number
  }) {
    const objects = new Set<string>()
    const state = { committedAt: null as number | null }
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const serve = (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : input)
      const method = init.method ?? 'GET'
      const objectRoute = '/storage/v1/object/community-images/'
      if (
        method === 'POST' &&
        url.pathname === '/storage/v1/object/list/community-images'
      ) {
        const { prefix } = JSON.parse(init.body as string) as { prefix: string }
        return Promise.resolve(
          json(
            [...objects]
              .filter((objectPath) => objectPath.startsWith(`${prefix}/`))
              .map((objectPath) => ({ name: objectPath.slice(prefix.length + 1) }))
          )
        )
      }
      if (method === 'DELETE' && url.pathname === '/storage/v1/object/community-images') {
        const { prefixes } = JSON.parse(init.body as string) as { prefixes: string[] }
        const removed = prefixes.filter((objectPath) => objects.delete(objectPath))
        return Promise.resolve(json(removed.map((name) => ({ name }))))
      }
      if (method === 'POST' && url.pathname.startsWith(objectRoute)) {
        if (options.upload === 'rejected') {
          return Promise.resolve(
            json(
              {
                statusCode: '409',
                error: 'Duplicate',
                message: 'The resource already exists',
              },
              400
            )
          )
        }
        const objectPath = decodeURIComponent(url.pathname.slice(objectRoute.length))
        setTimeout(() => {
          objects.add(objectPath)
          state.committedAt = Date.now()
        }, options.commitAfterMs)
        const reset = Object.assign(new Error('other side closed'), {
          code: 'UND_ERR_SOCKET',
        })
        return Promise.reject(new TypeError('fetch failed', { cause: reset }))
      }
      return Promise.resolve(json({ error: 'unexpected', message: url.pathname }, 400))
    }
    return { objects, state, serve }
  }

  async function storageClient(serve: typeof fetch) {
    const { storageFetch } = await canaryModule()
    const { createClient } = await import('@supabase/supabase-js')
    return createClient('http://storage.test', 'service-role-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: storageFetch(new AbortController().signal, serve) },
    }).storage
  }

  async function runAgainstStorage(
    server: ReturnType<typeof fakeStorageServer>,
    args: { timeoutMs: number; cleanupTimeoutMs: number; settleMs: number }
  ) {
    const storage = await storageClient(server.serve)
    const first = fakeClients('none')
    const fresh = fakeClients('none')
    return runWith(args, (opened) => ({
      ...(opened === 1 ? first.clients : fresh.clients),
      storage,
    }))
  }

  it('keeps cleanup uncertain when an upload lost its connection and the object lands later', async () => {
    // Story 6.2b final review (RF11). Codex's probe: storage-js returned a
    // transport error, the canary called it a configuration failure with a
    // known outcome, cleanup reported `clean` with no settle, and the object was
    // written 60 ms later.
    const server = fakeStorageServer({ upload: 'lost-connection', commitAfterMs: 900 })
    const { failure, returnedAt } = await runAgainstStorage(server, {
      timeoutMs: 2000,
      cleanupTimeoutMs: 500,
      settleMs: 50,
    })
    expect(failure.code).toBe('storage_outcome_unknown')
    expect((failure.cause as Error).name).toBe('StorageUnknownError')
    expect(failure.details.storageError).toEqual({
      name: 'StorageUnknownError',
      message: 'fetch failed',
      status: null,
      statusCode: null,
      originalError: {
        name: 'TypeError',
        message: 'fetch failed',
        cause: 'UND_ERR_SOCKET',
      },
    })
    expect(failure.cleanup).toMatchObject({
      status: 'uncertain',
      settleMs: 50,
      unknownOutcomes: [expect.stringMatching(/^object community-images\/community\//)],
      unresolved: [expect.stringMatching(/^object community-images\/community\//)],
      problems: [expect.stringMatching(/storage cannot cancel an upload/)],
    })
    await vi.waitFor(() => expect(server.objects.size).toBe(1), { timeout: 3000 })
    expect(server.state.committedAt).toBeGreaterThan(returnedAt)
  })

  it('calls an upload of unknown outcome resolved only once a lookup found and removed it', async () => {
    // Story 6.2b final review (RF11): the object lands 60 ms after the
    // transport error, inside the settle window.
    const server = fakeStorageServer({ upload: 'lost-connection', commitAfterMs: 60 })
    const { failure } = await runAgainstStorage(server, {
      timeoutMs: 2000,
      cleanupTimeoutMs: 1500,
      settleMs: 300,
    })
    expect(failure.code).toBe('storage_outcome_unknown')
    expect(failure.cleanup).toMatchObject({
      status: 'clean',
      problems: [],
      settleMs: 300,
      lateFound: [expect.stringMatching(/^object community-images\/community\//)],
      unresolved: [],
    })
    expect(server.state.committedAt).not.toBeNull()
    expect(server.objects.size).toBe(0)
  })

  it('treats a storage rejection with its error body as a known failure', async () => {
    // Story 6.2b final review (RF11).
    const server = fakeStorageServer({ upload: 'rejected' })
    const { failure } = await runAgainstStorage(server, {
      timeoutMs: 2000,
      cleanupTimeoutMs: 500,
      settleMs: 50,
    })
    expect(failure).toMatchObject({
      code: 'storage_rejected',
      details: {
        storageError: {
          name: 'StorageApiError',
          message: 'The resource already exists',
          status: 400,
          statusCode: '409',
        },
      },
    })
    expect(failure.cleanup).toMatchObject({
      status: 'clean',
      unknownOutcomes: [],
      settleMs: null,
    })
  })

  it('classifies a storage error as known only for a 4xx with the server error body', async () => {
    // Story 6.2b final review (RF11).
    const { storageOutcomeUnknown } = await canaryModule()
    const uploadError = async (answer: () => Promise<Response>) => {
      const storage = await storageClient(answer)
      const { error } = await storage
        .from('community-images')
        .upload('community/canary-post-x/a.jpg', Buffer.from('jpeg'))
      return error
    }
    const answer =
      (status: number, body: string, contentType = 'application/json') =>
      () =>
        Promise.resolve(
          new Response(body, { status, headers: { 'content-type': contentType } })
        )
    const cases: [string, () => Promise<Response>, boolean][] = [
      [
        'a 400 with the error body',
        answer(400, '{"statusCode":"409","error":"Duplicate","message":"exists"}'),
        false,
      ],
      [
        'a 413 with the error body',
        answer(
          413,
          '{"statusCode":"413","error":"Payload too large","message":"too large"}'
        ),
        false,
      ],
      [
        'a 400 from a proxy, no error body',
        answer(400, '<html>Bad Request</html>', 'text/html'),
        true,
      ],
      ['a 502 from a gateway', answer(502, '{"message":"bad gateway"}'), true],
      [
        'a 500 with the error body',
        answer(500, '{"statusCode":"500","error":"internal","message":"x"}'),
        true,
      ],
      ['a reset connection', () => Promise.reject(new TypeError('fetch failed')), true],
    ]
    for (const [label, respond, unknown] of cases) {
      const error = await uploadError(respond)
      expect({ label, unknown: storageOutcomeUnknown(error) }).toEqual({ label, unknown })
    }
    expect(storageOutcomeUnknown(new Error('anything else'))).toBe(true)
  })

  it('refuses a settle window that does not fit inside the cleanup deadline', async () => {
    const { parseCanaryArgs } = await canaryModule()
    expect(() =>
      parseCanaryArgs([
        '--target',
        'local',
        '--cleanup-timeout-ms',
        '1000',
        '--cleanup-settle-ms',
        '1000',
      ])
    ).toThrow(/--cleanup-settle-ms/)
    expect(parseCanaryArgs(['--target', 'local'])).toMatchObject({
      cleanupTimeoutMs: 30_000,
      cleanupSettleMs: 10_000,
    })
    expect(
      parseCanaryArgs(['--target', 'local', '--cleanup-timeout-ms', '1200'])
    ).toMatchObject({ cleanupTimeoutMs: 1200, cleanupSettleMs: 400 })
  })

  it('gives up on a Redis that accepts the connection and never answers', async () => {
    const { runCanary, parseCanaryArgs, redisOptions } = await canaryModule()
    const server = await stalledServer()
    const fake = fakeClients('none')
    const redis = new Redis(
      redisOptions(`redis://127.0.0.1:${server.port}`) as RedisOptions
    )
    redis.on('error', () => undefined)
    const queue = new Queue('community-moderation', { connection: redis })
    queue.on('error', () => undefined)
    const options = {
      ...parseCanaryArgs(['--target', 'local', '--timeout-ms', '800']),
      openClients: () => Promise.resolve({ ...fake.clients, redis, queue }),
    }
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://p:p@127.0.0.1:54322/postgres'
    const startedAt = Date.now()
    try {
      await expect(runCanary(options)).rejects.toMatchObject({
        code: 'deadline',
        details: { stage: 'connect' },
        cleanup: { performed: true, status: 'clean', problems: [] },
      })
      expect(Date.now() - startedAt).toBeLessThan(3000)
      await vi.waitFor(() => expect(redis.status).toBe('end'), { timeout: 2000 })
    } finally {
      process.env.DATABASE_URL = previous
      await server.close()
    }
  })

  it('exits nonzero with a failure report when every service stalls', async () => {
    const server = await stalledServer()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-stall-'))
    const reportPath = path.join(directory, 'report.json')
    try {
      const startedAt = Date.now()
      const child = await new Promise<{ status: number | null }>((resolve) => {
        const spawned = spawn(
          process.execPath,
          [
            path.join(repoRoot, 'scripts/community-screening-canary.mjs'),
            '--target',
            'local',
            '--timeout-ms',
            '1500',
            '--cleanup-timeout-ms',
            '1000',
            '--json-out',
            reportPath,
          ],
          {
            cwd: repoRoot,
            env: {
              PATH: process.env.PATH ?? '',
              DATABASE_URL: `postgresql://p:p@127.0.0.1:${server.port}/postgres`,
              REDIS_URL: `redis://127.0.0.1:${server.port}`,
              SUPABASE_URL: `http://127.0.0.1:${server.port}`,
              SUPABASE_SERVICE_ROLE_KEY: 'stalled-service-role-key',
            },
            stdio: 'ignore',
          }
        )
        spawned.on('exit', (status) => resolve({ status }))
      })
      expect(child.status).toBe(1)
      expect(Date.now() - startedAt).toBeLessThan(15_000)
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<
        string,
        unknown
      >
      expect(report).toMatchObject({
        ok: false,
        code: 'deadline',
        details: { stage: 'connect' },
        cleanup: { performed: true, status: 'clean', problems: [] },
        mode: 'canary',
        target: 'local',
      })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
      await server.close()
    }
  }, 30_000)
})

describe('restart drill evidence', () => {
  it('requires zero consumers around the enqueue and a consumer that came back', async () => {
    const { restartDrillProblems, parseCanaryArgs } = await load<CanaryModule>(
      'scripts/community-screening-canary.mjs'
    )
    const down = (observedAt: string, jobState?: string) =>
      heartbeatsSeen([], { observedAt, ...(jobState ? { jobState } : {}) })
    const proven = {
      beforeEnqueue: down('2026-10-17T12:00:00.000Z'),
      afterEnqueue: down('2026-10-17T12:00:00.300Z', 'waiting'),
      consumerReturned: heartbeatsSeen(
        [{ name: 'community-worker@abc123', instanceId: 'a' }],
        { observedAt: '2026-10-17T12:00:05.000Z' }
      ),
      observedDowntimeMs: 4500,
    }
    expect(restartDrillProblems(proven)).toEqual([])
    expect(restartDrillProblems(undefined)).toEqual(['no restart drill observations'])
    // Story 6.2b review (RF15): zero in CLIENT LIST is not zero consumers.
    expect(
      restartDrillProblems({
        ...proven,
        beforeEnqueue: {
          known: true,
          count: 0,
          names: [],
          observedAt: '2026-10-17T12:00:00.000Z',
        },
      })
    ).toEqual(['not counted from worker heartbeats: beforeEnqueue'])
    expect(
      restartDrillProblems({
        ...proven,
        beforeEnqueue: { ...proven.beforeEnqueue, known: false, count: null },
      })
    ).toEqual([expect.stringMatching(/before the job was enqueued/)])
    expect(
      restartDrillProblems({ ...proven, afterEnqueue: proven.consumerReturned })
    ).toContain(
      'zero consumers with the job waiting were not observed after the job was enqueued'
    )
    expect(restartDrillProblems({ ...proven, consumerReturned: null })).toEqual([
      'no consumer was observed coming back',
    ])
    expect(restartDrillProblems({ ...proven, observedDowntimeMs: Number.NaN })).toEqual([
      'observed downtime NaN ms',
    ])

    expect(parseCanaryArgs(['--target', 'local', '--restart-drill']).restartDrill).toBe(
      true
    )
    expect(() => parseCanaryArgs(['--target', 'hosted', '--restart-drill'])).toThrow(
      /local container only/
    )
    expect(() => parseCanaryArgs(['--target', 'local', '--no-worker-precheck'])).toThrow(
      /Unknown argument/
    )
    expect(() =>
      parseCanaryArgs(['--target', 'local', '--cleanup-timeout-ms', '0'])
    ).toThrow(/--cleanup-timeout-ms/)
    expect(
      (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts[
        'community:screening:canary:restart-drill'
      ]
    ).toContain('--restart-drill')
  })
})

describe('evidence input set', () => {
  // Story 6.2b peer review (CX3): a runtime import outside the hashed
  // directories changed what the worker accepts without changing the hash.
  const inputSet = () =>
    load<InputSetModule>('scripts/lib/community-screening-input-set.mjs')

  it('traces every repo-local import of the worker, including the wardrobe limits', async () => {
    const { traceWorkerSourceGraph, inputSetFiles } = await inputSet()
    const { files, unresolved } = traceWorkerSourceGraph()
    expect(unresolved).toEqual([])
    const set = new Set(inputSetFiles())
    for (const file of files) expect(set.has(file)).toBe(true)
    expect(set.has('apps/api/src/modules/wardrobe/wardrobe-image-validation.ts')).toBe(
      true
    )
    expect(set.has('apps/api/src/logger/pino.config.ts')).toBe(true)
    expect(set.has('packages/utils/src/index.ts')).toBe(true)
    expect(set.has('packages/db/prisma/schema.prisma')).toBe(true)
  })

  it('reaches every relative import the TypeScript scanner finds from the worker entries', async () => {
    // An independent parser (the compiler's own import scanner) over the same
    // entries, so the trace cannot pass by sharing a blind spot with itself.
    const ts = await import('typescript')
    const { WORKER_SOURCE_ENTRIES, inputSetFiles } = await inputSet()
    const set = new Set(inputSetFiles())
    const seen = new Set<string>()
    const queue = WORKER_SOURCE_ENTRIES.filter((entry) => entry.endsWith('.ts'))
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (seen.has(file)) continue
      seen.add(file)
      expect(set.has(file)).toBe(true)
      const { importedFiles } = ts.preProcessFile(read(file), true, true)
      for (const { fileName } of importedFiles) {
        if (!fileName.startsWith('.')) continue
        const base = path.join(path.dirname(file), fileName).replace(/\.js$/, '')
        const resolved = [`${base}.ts`, base, `${base}/index.ts`].find((candidate) =>
          fs.existsSync(path.join(repoRoot, candidate))
        )
        expect(resolved, `${file} imports ${fileName}`).toBeDefined()
        if (resolved?.endsWith('.ts')) queue.push(resolved)
      }
    }
    expect(seen.size).toBeGreaterThan(20)
  })

  it('carries the source of every entry the image prune trace starts from', async () => {
    const { WORKER_SOURCE_ENTRIES } = await inputSet()
    const prune = read('scripts/prune-community-worker-deps.mjs')
    const entries = /const ENTRY_FILES = \[([\s\S]*?)\]/.exec(prune)?.[1] ?? ''
    const compiled = [...entries.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '')
    expect(compiled.length).toBeGreaterThan(0)
    for (const entry of compiled) {
      const source = entry
        .replace(/^apps\/api\/dist\/src\//, 'apps/api/src/')
        .replace(/\.js$/, '.ts')
      expect(WORKER_SOURCE_ENTRIES).toContain(source)
    }
  })

  it('names every input path as a git pathspec', async () => {
    const { inputSetPathspecs, INPUT_DIRECTORIES } = await inputSet()
    const pathspecs = inputSetPathspecs()
    for (const directory of INPUT_DIRECTORIES) expect(pathspecs).toContain(directory)
    expect(pathspecs).toContain(
      'apps/api/src/modules/wardrobe/wardrobe-image-validation.ts'
    )
  })
})

describe('owner signature', () => {
  it('reports unsigned, valid and stale against the payload bytes', async () => {
    const { assessSignature, payloadDigest } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const payload = Buffer.from('{"verdict":"pass"}\n')
    const signature = { payloadSha256: payloadDigest(payload), ownerVerdict: 'approved' }
    expect(assessSignature(null, null).status).toBe('missing-payload')
    expect(assessSignature(payload, null).status).toBe('unsigned')
    expect(assessSignature(payload, signature).status).toBe('valid')
    expect(assessSignature(Buffer.from('{"verdict":"pass"} \n'), signature).status).toBe(
      'stale'
    )
  })

  it('refuses to sign without a terminal, under CI, or inside a coding-agent session', async () => {
    const { signingRefusal } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const tty = { stdinIsTTY: true, stdoutIsTTY: true }
    expect(signingRefusal({ ...tty, stdinIsTTY: false, env: {} })).toMatch(
      /interactive terminal/
    )
    expect(signingRefusal({ ...tty, env: { CI: 'true' } })).toMatch(/CI set/)
    expect(signingRefusal({ ...tty, env: { CLAUDECODE: '1' } })).toMatch(/CLAUDECODE set/)
    expect(signingRefusal({ ...tty, env: {} })).toBeNull()
  })

  it('allows delegated signing from an agent session but never under CI', async () => {
    const { signingRefusal } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const piped = { stdinIsTTY: false, stdoutIsTTY: false, delegated: true }
    expect(signingRefusal({ ...piped, env: { CLAUDECODE: '1' } })).toBeNull()
    expect(signingRefusal({ ...piped, env: { CI: 'true' } })).toMatch(/CI set/)
    expect(signingRefusal({ ...piped, env: { GITHUB_ACTIONS: 'true' } })).toMatch(
      /GITHUB_ACTIONS set/
    )
  })

  it('records a delegated approval only for a passing payload, with no quoted text', async () => {
    const { delegatedSignature } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    expect(delegatedSignature({ verdict: 'fail' }, 'a'.repeat(64)).refusal).toMatch(
      /verdict is fail/
    )
    expect(
      delegatedSignature({ verdict: 'incomplete' }, 'a'.repeat(64)).record
    ).toBeUndefined()
    const passedGates = await mandatoryGates()
    const { record } = delegatedSignature(
      { verdict: 'pass', generatedAt: '2026-10-16T00:00:00.000Z', gates: passedGates },
      'b'.repeat(64),
      new Date('2026-10-17T00:00:00.000Z')
    )
    expect(record).toEqual({
      artifact: 'community-content-screening-signature',
      gate: 'Community Beta model readiness',
      mode: 'delegated-by-owner',
      payloadPath:
        '_bmad-output/test-artifacts/community-content-screening-model-readiness.json',
      payloadSha256: 'b'.repeat(64),
      payloadVerdict: 'pass',
      payloadGeneratedAt: '2026-10-16T00:00:00.000Z',
      ownerVerdict: 'approved',
      signedAt: '2026-10-17T00:00:00.000Z',
    })
  })

  it('refuses a payload whose stored verdict disagrees with its own gates', async () => {
    // Story 6.2b final review (RF6): the stored verdict is an editable field, so a
    // payload edited to say pass over a failed or missing gate must not be signed.
    const { delegatedSignature, approvalRefusal } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const digest = 'c'.repeat(64)
    const withStatus = async (id: string, status: string) =>
      (await mandatoryGates()).map((entry) =>
        entry.id === id ? { ...entry, status } : entry
      )
    const tampered = { verdict: 'pass', gates: await withStatus('safe-corpus', 'failed') }
    expect(delegatedSignature(tampered, digest).refusal).toMatch(/its gates give fail/)
    expect(approvalRefusal(tampered)).toMatch(/its gates give fail/)
    expect(
      approvalRefusal({
        verdict: 'pass',
        gates: await withStatus('canary-hosted', 'not-run'),
      })
    ).toMatch(/its gates give incomplete/)
    expect(approvalRefusal({ verdict: 'pass', gates: await mandatoryGates() })).toBeNull()
  })

  it('refuses a payload that does not carry every mandatory gate exactly once', async () => {
    // Story 6.2b final review (RF9). Codex's probe: a payload cut down to one
    // passing `worker-image` gate recomputed to pass and could be approved.
    const { approvalRefusal, delegatedSignature } = await load<SignModule>(
      'scripts/sign-community-screening-readiness.mjs'
    )
    const { MANDATORY_GATE_IDS } = await load<GeneratorModule>(
      'scripts/generate-community-screening-readiness.mjs'
    )
    const gates = await mandatoryGates()
    const refusal = (edited: unknown) =>
      approvalRefusal({ verdict: 'pass', gates: edited as Gate[] })

    const cutDown = [{ id: 'worker-image', status: 'passed' }]
    expect(refusal(cutDown)).toMatch(/not the generator's mandatory set/)
    expect(refusal(cutDown)).toContain(
      `missing ${MANDATORY_GATE_IDS.filter((id) => id !== 'worker-image').join(', ')}`
    )
    const delegated = delegatedSignature(
      { verdict: 'pass', gates: cutDown },
      'd'.repeat(64)
    )
    expect(delegated.record).toBeUndefined()
    expect(delegated.refusal).toMatch(/missing committed-tree/)
    expect(refusal(gates.filter((entry) => entry.id !== 'canary-hosted'))).toMatch(
      /missing canary-hosted\)/
    )
    expect(refusal([...gates, { id: 'worker-image', status: 'passed' }])).toMatch(
      /repeated worker-image\)/
    )
    expect(refusal([...gates, { id: 'extra-gate', status: 'passed' }])).toMatch(
      /unknown extra-gate\)/
    )
    expect(refusal([...gates.slice(1), { status: 'passed' }])).toMatch(
      /missing committed-tree; unknown undefined\)/
    )
    expect(refusal([])).toMatch(/missing committed-tree/)
    expect(approvalRefusal({ verdict: 'pass' })).toMatch(/carries no gate list/)
    expect(refusal(gates)).toBeNull()
  })

  it('takes the mandatory gate ids from the gates the generator builds', async () => {
    // One source of truth: the list the sign command checks is the list
    // buildGates produces, in order, whatever the sections hold.
    const { buildGates, MANDATORY_GATE_IDS, gateSetProblems } =
      await load<GeneratorModule>('scripts/generate-community-screening-readiness.mjs')
    expect(buildGates({}).map((entry) => entry.id)).toEqual([...MANDATORY_GATE_IDS])
    expect(new Set(MANDATORY_GATE_IDS).size).toBe(MANDATORY_GATE_IDS.length)
    expect(Object.isFrozen(MANDATORY_GATE_IDS)).toBe(true)
    expect(gateSetProblems(buildGates({}))).toEqual([])
  })
})

/** Every mandatory gate, passed, in the generator's order. */
async function mandatoryGates(): Promise<Gate[]> {
  const { MANDATORY_GATE_IDS } = await load<GeneratorModule>(
    'scripts/generate-community-screening-readiness.mjs'
  )
  return MANDATORY_GATE_IDS.map((id) => ({ id, name: id, status: 'passed' }))
}

describe('safe corpus manifest checks', () => {
  it('refuses a missing, short, non-commercial or duplicated corpus', async () => {
    const { verifyManifest, MINIMUM_COUNT } = await load<CorpusModule>(
      'scripts/fetch-community-safe-corpus.mjs'
    )
    const store = path.join(repoRoot, 'apps/api/.cache/no-such-store')
    const entry = (id: string, license: string, sha: string) => ({
      id,
      source: 'flickr',
      license,
      url: `https://example.invalid/${id}.jpg`,
      sha256: sha.repeat(64),
      file: `${id}.jpg`,
    })
    expect(verifyManifest(null, store).problems.length).toBeGreaterThan(0)
    const short = verifyManifest(
      { corpusId: 'community-safe-photographs-v1', entries: [entry('a', 'by', 'a')] },
      store
    )
    expect(short.problems.join(' ')).toMatch(
      new RegExp(`below the minimum of ${MINIMUM_COUNT}`)
    )
    const bad = verifyManifest(
      {
        corpusId: 'community-safe-photographs-v1',
        entries: [entry('a', 'by-nc', 'a'), entry('b', 'by', 'a')],
      },
      store
    )
    expect(bad.problems.join(' ')).toMatch(/does not permit commercial use/)
    expect(bad.problems.join(' ')).toMatch(/duplicates the bytes/)
  })
})

describe('term list generation', () => {
  it('drops what the screener cannot index unless the allow list makes it indexable', async () => {
    const { unindexableReason } = await load<ListsModule>(
      'scripts/verify-community-screening-lists.mjs'
    )
    expect(unindexableReason('\u{1F595}', new Set())).toMatch(/no letters/)
    expect(unindexableReason('ass', new Set())).toMatch(/single-term floor/)
    expect(unindexableReason('kys', new Set())).toBeNull()
    expect(unindexableReason('jizz', new Set())).toMatch(/collapses to "jiz"/)
    expect(unindexableReason('jizz', new Set(['jiz']))).toBeNull()
    expect(unindexableReason('two girls one cup', new Set())).toBeNull()
  })
})

interface CalibrationModule {
  UNSAFE_BOUNDS: Record<string, number>
  dispositionUnder: (
    variant: Record<string, unknown>,
    p: Record<string, number>
  ) => string
  chooseConfiguration: (
    byFamily: Record<
      string,
      { id: string; withheldRate: number; kind: string; safeMassMinimum?: number }[]
    >,
    fits: (family: string) => boolean
  ) => { family: string; id: string } | undefined
}

describe('model calibration', () => {
  const vector = (p: Partial<Record<string, number>>) => ({
    Drawing: 0,
    Hentai: 0,
    Neutral: 0,
    Porn: 0,
    Sexy: 0,
    ...p,
  })

  it('holds every unsafe bound at its original value in every variant', async () => {
    const { UNSAFE_BOUNDS, dispositionUnder } = await load<CalibrationModule>(
      'scripts/calibrate-community-screening-models.mjs'
    )
    expect(UNSAFE_BOUNDS).toEqual({
      blockMinimum: 0.35,
      unsafeAggregateMaximum: 0.1,
      sexyPassMaximum: 0.15,
      jointMaximum: 0.15,
    })
    const loose = { kind: 'safe-mass', safeMassMinimum: 0.5 }
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.5, Neutral: 0.3, Porn: 0.36 }))
    ).toBe('block')
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.8, Hentai: 0.05, Porn: 0.05 }))
    ).toBe('review')
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.7, Neutral: 0.15, Sexy: 0.15 }))
    ).toBe('review')
    expect(
      dispositionUnder(loose, vector({ Drawing: 0.7, Neutral: 0.2, Sexy: 0.1 }))
    ).toBe('pass')
    // Each class inside its own bound, together at the joint ceiling.
    expect(
      dispositionUnder(
        loose,
        vector({ Drawing: 0.85, Hentai: 0.04, Porn: 0.04, Sexy: 0.07 })
      )
    ).toBe('review')
    expect(
      dispositionUnder({ kind: 'current' }, vector({ Drawing: 0.9, Neutral: 0.1 }))
    ).toBe('review')
  })

  it('picks the lowest withheld rate among fitting families, ties to the stricter value', async () => {
    const { chooseConfiguration } = await load<CalibrationModule>(
      'scripts/calibrate-community-screening-models.mjs'
    )
    const variant = (id: string, safeMassMinimum: number, withheldRate: number) => ({
      id,
      kind: 'safe-mass',
      safeMassMinimum,
      withheldRate,
    })
    const chosen = chooseConfiguration(
      {
        mobilenet_v2: [variant('a', 0.8, 0.1)],
        mobilenet_v2_mid: [variant('b', 0.8, 0.2), variant('c', 0.75, 0.2)],
        inception_v3: [variant('d', 0.8, 0.05)],
      },
      (family) => family !== 'inception_v3' && family !== 'mobilenet_v2'
    )
    expect(chosen).toMatchObject({ family: 'mobilenet_v2_mid', id: 'b' })
  })
})

describe('committed corpora and lists, checked in the ordinary suite', () => {
  it('keeps every vendored and generated list identical to what its sources produce', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/verify-community-screening-lists.mjs'), '--json'],
      { cwd: repoRoot, encoding: 'utf8' }
    )
    const report = JSON.parse(output) as { status: string; problems: string[] }
    expect(report.problems).toEqual([])
    expect(report.status).toBe('verified')
  })

  it('licenses every committed safe-corpus photograph for commercial use', async () => {
    const { verifyManifest } = await load<CorpusModule>(
      'scripts/fetch-community-safe-corpus.mjs'
    )
    const manifest = JSON.parse(
      read('apps/api/test/fixtures/community-safe-corpus/manifest.json')
    ) as Record<string, unknown>
    // An absent store checks the manifest alone: licences, hashes, duplicates,
    // the creator cap, the split and the minimum count.
    const result = verifyManifest(
      manifest,
      path.join(repoRoot, 'apps/api/.cache/no-such-store')
    )
    expect(result.problems).toEqual([])
  })
})

interface RegressionGateModule {
  assessRuntimeAgainstGates: (
    report: Record<string, unknown>,
    performance: Record<string, unknown>
  ) => { ok: boolean; failures: string[] }
}

/**
 * Story 6.2 Task 6: a runtime measurement above the committed regression gate
 * or an absolute ceiling must fail the command, not just appear in a report.
 */
type GatedMetric = 'coldStartupMs' | 'warmP95Ms' | 'warmP99Ms' | 'peakResidentMib'

describe('runtime regression gate', () => {
  const manifestPath = path.join(
    repoRoot,
    'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
  )
  const performance = (
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      performance: {
        regressionGate: Record<GatedMetric, number>
        absoluteCeilings: Record<GatedMetric, number>
      }
    }
  ).performance
  const gate = performance.regressionGate

  /** A report exactly at every regression gate, which must still pass. */
  const atGate = () => ({
    warmSamples: 1000,
    coldStartupMs: gate.coldStartupMs,
    warmSupervisedMs: { p95: gate.warmP95Ms, p99: gate.warmP99Ms },
    peakResidentMib: gate.peakResidentMib,
  })

  function runGate(report: Record<string, unknown>) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'community-gate-'))
    const reportPath = path.join(directory, 'runtime.json')
    fs.writeFileSync(reportPath, JSON.stringify(report))
    try {
      return spawnSync(
        process.execPath,
        [
          path.join(repoRoot, 'scripts/check-community-worker-regression-gate.mjs'),
          reportPath,
        ],
        { cwd: repoRoot, encoding: 'utf8' }
      )
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }

  it('commits a gate for every metric it checks, never above its ceiling', () => {
    const metrics: GatedMetric[] = [
      'coldStartupMs',
      'warmP95Ms',
      'warmP99Ms',
      'peakResidentMib',
    ]
    for (const key of metrics) {
      expect(gate[key]).toBeGreaterThan(0)
      expect(gate[key]).toBeLessThanOrEqual(performance.absoluteCeilings[key])
    }
  })

  it('exits 0 for a run at the gate and 1 for a run one step past it', () => {
    const passing = runGate(atGate())
    expect(passing.status, passing.stderr).toBe(0)

    const slow = runGate({
      ...atGate(),
      warmSupervisedMs: { p95: gate.warmP95Ms + 0.01, p99: gate.warmP99Ms },
    })
    expect(slow.status).toBe(1)
    expect(slow.stderr).toMatch(/warmP95Ms .* above the regression gate/)
  })

  it.each([
    ['cold startup past its gate', { coldStartupMs: gate.coldStartupMs + 1 }],
    ['warm p99 past its gate', { warmSupervisedMs: { p95: 1, p99: gate.warmP99Ms + 1 } }],
    ['peak RSS past the memory ceiling', { peakResidentMib: gate.peakResidentMib + 1 }],
    ['a missing measurement', { peakResidentMib: undefined }],
    ['no warm samples', { warmSamples: 0 }],
  ])('fails on %s', async (_label, patch) => {
    const { assessRuntimeAgainstGates } = await load<RegressionGateModule>(
      'scripts/check-community-worker-regression-gate.mjs'
    )
    const verdict = assessRuntimeAgainstGates({ ...atGate(), ...patch }, performance)
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.length).toBeGreaterThan(0)
  })

  it('fails when the manifest drops a gate, so a deleted limit cannot pass silently', async () => {
    const { assessRuntimeAgainstGates } = await load<RegressionGateModule>(
      'scripts/check-community-worker-regression-gate.mjs'
    )
    const withoutP95 = Object.fromEntries(
      Object.entries(gate).filter(([key]) => key !== 'warmP95Ms')
    )
    const verdict = assessRuntimeAgainstGates(atGate(), {
      ...performance,
      regressionGate: withoutP95,
    })
    expect(verdict.failures).toContain(
      'the manifest has no regression gate for warmP95Ms'
    )
  })
})

interface Gate {
  id: string
  status: 'passed' | 'failed' | 'not-run'
  problems?: string[]
}
interface GeneratorModule {
  buildGates: (sections: Record<string, unknown>) => Gate[]
  verdictOf: (gates: Gate[]) => string
  MANDATORY_GATE_IDS: readonly string[]
  gateSetProblems: (gates: unknown) => string[]
  cleanupProblems: (canary: Record<string, unknown>) => string[]
  wilsonInterval: (successes: number, trials: number) => [number, number]
  inputStaleness: (recorded: unknown, current: string) => string[]
  deployedInputBinding: (
    binding: { expectedSha: unknown; commitSha: unknown; pathspecs: string[] },
    root?: string
  ) => { status: string; reason?: string }
  TEXT_LANGUAGES: string[]
  payAsYouGoMonthlyUsd: (commands: number) => number
  projectRedisCost: (inputs: {
    idleCommandsPerHour: unknown
    commandsPerPost: unknown
    dailySubmissions: number
  }) => {
    postsPerDayAtCostCeiling: number | null
    projectedMonthly: Record<string, number> | null
  }
  REDIS_MONTHLY_COST_CEILING_USD: number
}

/** One change to the passing sections: a dotted path and its new value (undefined deletes). */
type Patch = [path: string, value: unknown]

function applyPatch(target: Record<string, unknown>, [dotted, value]: Patch) {
  const keys = dotted.split('.')
  const last = keys.pop() as string
  let node = target
  for (const key of keys) node = node[key] as Record<string, unknown>
  if (value === undefined) delete node[last]
  else node[last] = value
}

/**
 * Story 6.2b review (VG2): the release verdict, which a delegated signature
 * trusts, must fail closed. Sections are built in memory so every branch is
 * reached without Docker, Redis or the model.
 */
describe('readiness verdict', () => {
  const generator = () =>
    load<GeneratorModule>('scripts/generate-community-screening-readiness.mjs')

  async function passingSections(): Promise<Record<string, unknown>> {
    const { wilsonInterval, TEXT_LANGUAGES } = await generator()
    const alone = () =>
      heartbeatsSeen([{ name: 'community-worker@abc123', instanceId: 'instance-a' }])
    const soleConsumer = () => ({
      proven: true,
      expectedWorker: 'community-worker@abc123',
      before: alone(),
      after: alone(),
      problems: [],
    })
    const canary = (target: string) => ({
      available: true,
      stale: [],
      ok: true,
      target,
      disposition: 'pass',
      engineIdentity: REAL_IDENTITY,
      expectedSha: 'abc123',
      processedBy: 'community-worker@abc123',
      soleConsumer: soleConsumer(),
      timings: { queueLatencyMs: 3, screeningDurationMs: 190 },
      cleanup: { performed: true, status: 'clean', problems: [] },
    })
    const clean = () => ({
      total: 420,
      withheld: 0,
      recomputedUpperBound: wilsonInterval(0, 420)[1],
      expectedReviewIds: [],
      expectedReviewThatPassed: [],
    })
    return {
      workingTree: { clean: true, changedPaths: 0, sample: [] },
      image: {
        available: true,
        stale: [],
        nodeModulesMb: 112,
        user: 'node',
        entrypoint: ['/usr/bin/tini', '--'],
        commitSha: 'abc123',
      },
      canaries: {
        local: canary('local'),
        restart: {
          ...canary('local'),
          mode: 'restart-drill',
          restartDrill: {
            beforeEnqueue: heartbeatsSeen([], {
              observedAt: '2026-10-17T12:00:00.000Z',
            }),
            afterEnqueue: heartbeatsSeen([], {
              observedAt: '2026-10-17T12:00:00.200Z',
              jobState: 'waiting',
            }),
            lastDownObservedAt: '2026-10-17T12:00:09.000Z',
            consumerReturned: { ...alone(), observedAt: '2026-10-17T12:00:09.500Z' },
            observedDowntimeMs: 9000,
          },
        },
        hosted: {
          ...canary('hosted'),
          deployedInputs: { status: 'same', expectedSha: 'abc123', commitSha: 'def456' },
        },
      },
      sweep: {
        available: true,
        stale: [],
        sweep: {
          vectorCount: 100,
          oracleDisagreements: 0,
          passAtOrAboveAReviewThreshold: 0,
        },
        coverage: {
          functions: [{ functionName: 'disposition', blocks: 9, uncoveredBlocks: 0 }],
        },
      },
      calibration: {
        available: true,
        stale: [],
        calibrationEntries: 300,
        chosen: {
          family: 'mobilenet_v2_mid',
          id: 'safe-mass@0.8',
          safeMassMinimum: 0.8,
          withheldRate: 0.1,
        },
        shipped: {
          family: 'mobilenet_v2_mid',
          safeMassMinimum: 0.8,
          bounds: { blockMinimum: 0.35, jointMaximum: 0.15 },
        },
        unsafeBounds: { blockMinimum: 0.35, jointMaximum: 0.15 },
      },
      safeCorpus: {
        available: true,
        stale: [],
        split: 'holdout',
        evaluated: 300,
        validationRejected: [],
        holdoutEntries: 300,
        manifest: { holdoutEntries: 300 },
        counts: { pass: 300, review: 0, block: 0 },
        withheld: 0,
        withheldRate: 0,
        recomputedWilson95: wilsonInterval(0, 300),
        triageMissing: [],
      },
      text: {
        available: true,
        stale: [],
        missingLanguages: [],
        languages: Object.fromEntries(
          TEXT_LANGUAGES.map((language) => [
            language,
            {
              clean: clean(),
              cleanInSample: clean(),
              disallowed: { total: 100, bypassIds: [] },
            },
          ])
        ),
      },
      lists: {
        verification: { status: 'verified', problems: [] },
        allowList: { everyEntryHasReason: true },
      },
      model: { status: 'verified', failures: [] },
      runtime: {
        ceilings: {
          coldStartupMs: 30000,
          warmP95Ms: 3000,
          warmP99Ms: 5000,
          peakResidentMib: 512,
        },
        latency: {
          available: true,
          stale: [],
          warmupSamples: 50,
          warmSamples: 1000,
          environment: { containerCpuQuota: 0.2, containerMemoryLimitMib: 512 },
          coldStartupMs: 2400,
          warmSupervisedMs: { p95: 300, p99: 400 },
        },
        memory: {
          available: true,
          stale: [],
          canaryOk: true,
          commitSha: 'abc123',
          workerName: 'community-worker@abc123',
          processedBy: 'community-worker@abc123',
          soleConsumer: soleConsumer(),
          upload: { name: 'generated-4096x4096.jpg' },
          memoryLimitMib: 512,
          memoryPeakMib: 300,
        },
      },
      redis: {
        available: true,
        stale: [],
        monthlyCostCeilingUsd: 5,
        dailySubmissions: 100,
        postsPerDayAtCostCeiling: 962,
        projectedMonthly: {
          total: 350000,
          idleUsd: 0.2,
          trafficUsd: 0.5,
          totalUsd: 0.7,
        },
        idle: {
          commandsPerHour: 138,
          worker: {
            name: 'community-worker@abc123',
            commitSha: 'abc123',
            presenceSource: 'heartbeat',
            samples: 121,
            connectedSamples: 121,
            connectedThroughout: true,
            instanceIds: ['instance-a'],
          },
        },
        perPost: { commandsPerPost: 82 },
      },
      rollout: { communityReadEnabled: false, communityWriteEnabled: false },
    }
  }

  async function verdictAfter(patches: Patch[]) {
    const { buildGates, verdictOf } = await generator()
    const sections = await passingSections()
    for (const patch of patches) applyPatch(sections, patch)
    const gates = buildGates(sections)
    return { verdict: verdictOf(gates), gates }
  }

  const statusOf = (gates: Gate[], id: string) =>
    gates.find((entry) => entry.id === id)?.status
  const notRun = { available: false, stale: [] }

  it('passes only when every gate ran against current inputs and passed', async () => {
    const { verdict, gates } = await verdictAfter([])
    expect(gates.filter((entry) => entry.status !== 'passed')).toEqual([])
    expect(verdict).toBe('pass')
  })

  it('fails when any gate that ran failed, even beside a gate that did not run', async () => {
    const { verdict } = await verdictAfter([
      ['model.status', 'failed'],
      ['canaries.hosted', notRun],
    ])
    expect(verdict).toBe('fail')
  })

  it.each<[string, Patch[]]>([
    ['a gate that has not run', [['canaries.hosted', notRun]]],
    [
      'a dirty working tree',
      [['workingTree', { clean: false, changedPaths: 3, sample: ['a'] }]],
    ],
    [
      'a stale run product',
      [['safeCorpus.stale', ['inputs changed since the measurement']]],
    ],
    [
      'an image built from other inputs',
      [['image.stale', ['no input-set hash recorded']]],
    ],
    [
      'an undescribed withheld photograph',
      [['safeCorpus.triageMissing', ['openverse-1']]],
    ],
  ])('is incomplete with %s', async (_label, patches) => {
    const { verdict } = await verdictAfter(patches)
    expect(verdict).toBe('incomplete')
  })

  it.each<[string, Patch[]]>([
    // Story 6.2b peer review (CX2): an older deployment passed the current gate.
    [
      'a deployed commit whose inputs differ',
      [['canaries.hosted.deployedInputs', { status: 'differs', reason: 'x differs' }]],
    ],
    [
      'a deployed commit git cannot compare',
      [['canaries.hosted.deployedInputs', { status: 'unknown', reason: 'unknown' }]],
    ],
    ['no deployed commit comparison', [['canaries.hosted.deployedInputs', undefined]]],
  ])('does not run the hosted canary gate with %s', async (_label, patches) => {
    const { verdict, gates } = await verdictAfter(patches)
    expect(statusOf(gates, 'canary-hosted')).toBe('not-run')
    expect(verdict).toBe('incomplete')
  })

  it.each<[string, string, Patch[]]>([
    [
      'an upper bound of 0.0501',
      'safe-corpus',
      [['safeCorpus.recomputedWilson95', [0.03, 0.0501]]],
    ],
    [
      'fewer than 250 holdout photographs',
      'safe-corpus',
      [
        ['safeCorpus.evaluated', 249],
        ['safeCorpus.holdoutEntries', 249],
        ['safeCorpus.manifest.holdoutEntries', 249],
      ],
    ],
    ['a partial holdout run', 'safe-corpus', [['safeCorpus.evaluated', 280]]],
    [
      'a holdout count unlike the manifest',
      'safe-corpus',
      [['safeCorpus.manifest.holdoutEntries', 310]],
    ],
    ['a blocked safe photograph', 'safe-corpus', [['safeCorpus.counts.block', 1]]],
    [
      'a missing text language',
      'text-clean-copy',
      [
        ['text.languages.tr', undefined],
        ['text.missingLanguages', ['tr']],
      ],
    ],
    [
      'a withheld holdout caption',
      'text-clean-copy',
      [
        ['text.languages.fr.clean.withheld', 1],
        ['text.languages.fr.clean.recomputedUpperBound', 0.0133],
      ],
    ],
    [
      'an obfuscation bypass',
      'text-obfuscation',
      [['text.languages.de.disallowed.bypassIds', ['de-x-1']]],
    ],
    [
      'a hosted gate fed a local canary',
      'canary-hosted',
      [['canaries.hosted.target', 'local']],
    ],
    [
      'a job processed by another build',
      'canary-hosted',
      [['canaries.hosted.processedBy', 'community-worker@zzz']],
    ],
    [
      'a fixture identity',
      'canary-local-container',
      [['canaries.local.engineIdentity', 'adr013-nsfw-fixture']],
    ],
    [
      'a calibration that chose another floor',
      'model-calibration',
      [['calibration.chosen.safeMassMinimum', 0.75]],
    ],
    [
      'a calibration run under other bounds',
      'model-calibration',
      [['calibration.unsafeBounds.jointMaximum', 0.2]],
    ],
    [
      'a null warm percentile',
      'runtime-latency',
      [['runtime.latency.warmSupervisedMs.p95', null]],
    ],
    ['zero warm samples', 'runtime-latency', [['runtime.latency.warmSamples', 0]]],
    ['missing ceilings', 'runtime-latency', [['runtime.ceilings', null]]],
    [
      'a memory peak from a small upload',
      'runtime-memory',
      [['runtime.memory.upload.name', 'safe-satin-plum-512x512.jpg']],
    ],
    [
      'a memory peak above the ceiling',
      'runtime-memory',
      [['runtime.memory.memoryPeakMib', 513]],
    ],
    [
      'a sweep with an oracle disagreement',
      'policy-surface',
      [['sweep.sweep.oracleDisagreements', 1]],
    ],
    [
      'a sweep that recorded no count',
      'policy-surface',
      [['sweep.sweep.passAtOrAboveAReviewThreshold', undefined]],
    ],
    ['a Redis count that is missing', 'redis-budget', [['redis.projectedMonthly', null]]],
    // The production database is on Upstash Pay as You Go: the gate is the bill.
    [
      'a projected Redis month a cent above 5 USD',
      'redis-budget',
      [['redis.projectedMonthly.totalUsd', 5.0001]],
    ],
    // Story 6.2b peer review (CX9).
    [
      'canary cleanup problems',
      'canary-local-container',
      [
        [
          'canaries.local.cleanup',
          { performed: true, status: 'failed', problems: ['job: x'] },
        ],
      ],
    ],
    [
      'a canary that reported its cleanup failure',
      'canary-hosted',
      [
        ['canaries.hosted.ok', false],
        ['canaries.hosted.code', 'cleanup_failed'],
        [
          'canaries.hosted.cleanup',
          { performed: true, status: 'failed', problems: ['account: x'] },
        ],
      ],
    ],
    [
      'restart drill cleanup problems',
      'restart-keeps-queued-jobs',
      [
        [
          'canaries.restart.cleanup',
          { performed: true, status: 'failed', problems: ['object: x'] },
        ],
      ],
    ],
    // Story 6.2b final review (RF7): a cleanup that cannot say whether a late
    // write left data behind is not a clean one, even with no problem listed.
    [
      'a canary whose cleanup is uncertain',
      'canary-local-container',
      [
        [
          'canaries.local.cleanup',
          {
            performed: true,
            status: 'uncertain',
            problems: [],
            unresolved: ['account canary-user-x'],
          },
        ],
      ],
    ],
    [
      'a failed hosted canary whose cleanup is uncertain',
      'canary-hosted',
      [
        ['canaries.hosted.ok', false],
        ['canaries.hosted.code', 'deadline'],
        [
          'canaries.hosted.cleanup',
          {
            performed: true,
            status: 'uncertain',
            problems: ['cleanup deadline'],
            unresolved: ['post canary-post-x'],
          },
        ],
      ],
    ],
    [
      'a restart drill whose cleanup is uncertain',
      'restart-keeps-queued-jobs',
      [
        [
          'canaries.restart.cleanup',
          {
            performed: true,
            status: 'uncertain',
            problems: [],
            unresolved: ['job canary-post-x__canary-upload-x'],
          },
        ],
      ],
    ],
    [
      'a canary cleanup with no status',
      'canary-local-container',
      [['canaries.local.cleanup', { performed: true, problems: [] }]],
    ],
    // Story 6.2b final review (RF1): success alone proved no restart. Codex's
    // probe: an ordinary canary with the worker check skipped and 1 ms of queue
    // latency passed the restart gate.
    [
      'an ordinary canary offered as restart evidence',
      'restart-keeps-queued-jobs',
      [
        ['canaries.restart.mode', 'canary'],
        ['canaries.restart.restartDrill', undefined],
        ['canaries.restart.workersConnected', { known: false, count: null }],
        ['canaries.restart.timings', { queueLatencyMs: 1, screeningDurationMs: 190 }],
      ],
    ],
    [
      'a restart product with no mode',
      'restart-keeps-queued-jobs',
      [['canaries.restart.mode', undefined]],
    ],
    [
      'a drill that found a consumer before it enqueued',
      'restart-keeps-queued-jobs',
      [['canaries.restart.restartDrill.beforeEnqueue.count', 1]],
    ],
    [
      'a drill that could not list the consumers',
      'restart-keeps-queued-jobs',
      [['canaries.restart.restartDrill.beforeEnqueue.known', false]],
    ],
    [
      'a drill whose job was not waiting after the enqueue',
      'restart-keeps-queued-jobs',
      [['canaries.restart.restartDrill.afterEnqueue.jobState', 'active']],
    ],
    [
      'a drill that never saw a consumer come back',
      'restart-keeps-queued-jobs',
      [['canaries.restart.restartDrill.consumerReturned', undefined]],
    ],
    [
      'a drill whose consumer came back before the job was queued',
      'restart-keeps-queued-jobs',
      [
        [
          'canaries.restart.restartDrill.consumerReturned.observedAt',
          '2026-10-17T12:00:00.100Z',
        ],
      ],
    ],
    [
      'a drill with no observed downtime',
      'restart-keeps-queued-jobs',
      [['canaries.restart.restartDrill.observedDowntimeMs', null]],
    ],
    [
      'a canary with no cleanup record',
      'canary-hosted',
      [['canaries.hosted.cleanup', undefined]],
    ],
    // Story 6.2b peer review (CX5).
    [
      'latency measured with no CPU limit',
      'runtime-latency',
      [['runtime.latency.environment.containerCpuQuota', null]],
    ],
    [
      'latency measured under another memory limit',
      'runtime-latency',
      [['runtime.latency.environment.containerMemoryLimitMib', 1024]],
    ],
    ['a single warm sample', 'runtime-latency', [['runtime.latency.warmSamples', 1]]],
    ['999 warm samples', 'runtime-latency', [['runtime.latency.warmSamples', 999]]],
    ['no warmup', 'runtime-latency', [['runtime.latency.warmupSamples', 0]]],
    // Story 6.2b peer review (CX4).
    [
      'a memory upload processed by another worker',
      'runtime-memory',
      [['runtime.memory.processedBy', 'community-worker@zzz']],
    ],
    [
      'a memory measurement with no worker identity',
      'runtime-memory',
      [
        ['runtime.memory.workerName', undefined],
        ['runtime.memory.processedBy', undefined],
      ],
    ],
    [
      'a memory measurement of an image with no commit',
      'runtime-memory',
      [['runtime.memory.commitSha', 'unset']],
    ],
    // Story 6.2b second peer review (CX4b).
    [
      'a memory peak with no sole-consumer proof',
      'runtime-memory',
      [['runtime.memory.soleConsumer', undefined]],
    ],
    [
      'a memory peak whose canary did not prove a sole consumer',
      'runtime-memory',
      [['runtime.memory.soleConsumer.proven', false]],
    ],
    [
      'a memory peak with a second replica connected after the job',
      'runtime-memory',
      [
        [
          'runtime.memory.soleConsumer.after',
          heartbeatsSeen([
            { name: 'community-worker@abc123', instanceId: 'instance-a' },
            { name: 'community-worker@abc123', instanceId: 'instance-b' },
          ]),
        ],
      ],
    ],
    [
      'a memory peak whose one consumer was another process after the run',
      'runtime-memory',
      [
        [
          'runtime.memory.soleConsumer.after',
          heartbeatsSeen([{ name: 'community-worker@abc123', instanceId: 'instance-b' }]),
        ],
      ],
    ],
    // Story 6.2b review (RF15): CLIENT LIST on Upstash shows one node, so a
    // recorded observation must be a heartbeat count.
    [
      'a memory peak proven from CLIENT LIST',
      'runtime-memory',
      [
        [
          'runtime.memory.soleConsumer.before',
          {
            known: true,
            count: 1,
            names: ['bull:Y29tbXVuaXR5LW1vZGVyYXRpb24=:w:community-worker@abc123'],
            clientIds: ['378'],
          },
        ],
      ],
    ],
    [
      'a hosted canary proven from CLIENT LIST',
      'canary-hosted',
      [['canaries.hosted.soleConsumer.after.source', undefined]],
    ],
    [
      'a hosted canary whose consumer heartbeat had no TTL',
      'canary-hosted',
      [
        [
          'canaries.hosted.soleConsumer.after',
          heartbeatsSeen([
            {
              name: 'community-worker@abc123',
              instanceId: 'instance-a',
              problems: ['the key has no TTL, so it never expires'],
            },
          ]),
        ],
      ],
    ],
    [
      'a drill whose returning consumer came from CLIENT LIST',
      'restart-keeps-queued-jobs',
      [['canaries.restart.restartDrill.consumerReturned.source', undefined]],
    ],
    [
      'a memory peak proven for another worker',
      'runtime-memory',
      [['runtime.memory.soleConsumer.expectedWorker', 'community-worker@zzz']],
    ],
    [
      'a hosted canary with no sole-consumer proof',
      'canary-hosted',
      [['canaries.hosted.soleConsumer', undefined]],
    ],
    // Story 6.2b peer review (CX6).
    [
      'an idle window with no worker identity',
      'redis-budget',
      [['redis.idle.worker', undefined]],
    ],
    [
      'an idle window the worker left',
      'redis-budget',
      [
        ['redis.idle.worker.connectedSamples', 120],
        ['redis.idle.worker.connectedThroughout', false],
      ],
    ],
    [
      'an idle window naming another worker',
      'redis-budget',
      [['redis.idle.worker.name', 'community-worker@zzz']],
    ],
    [
      'an idle window sampled from CLIENT LIST',
      'redis-budget',
      [['redis.idle.worker.presenceSource', undefined]],
    ],
    [
      'an idle window across a worker restart',
      'redis-budget',
      [['redis.idle.worker.instanceIds', ['instance-a', 'instance-b']]],
    ],
  ])('fails on %s', async (_label, gateId, patches) => {
    const { verdict, gates } = await verdictAfter(patches)
    expect(statusOf(gates, gateId)).toBe('failed')
    expect(verdict).toBe('fail')
  })

  it('passes a projected Redis month of exactly 5 USD', async () => {
    const { gates } = await verdictAfter([['redis.projectedMonthly.totalUsd', 5]])
    expect(statusOf(gates, 'redis-budget')).toBe('passed')
  })

  it('prices Redis commands at Upstash Pay as You Go', async () => {
    const { payAsYouGoMonthlyUsd, projectRedisCost, REDIS_MONTHLY_COST_CEILING_USD } =
      await generator()
    // 0.20 USD per 100K commands, no included commands on a paid plan.
    expect(payAsYouGoMonthlyUsd(100_000)).toBeCloseTo(0.2, 10)
    expect(payAsYouGoMonthlyUsd(2_500_000)).toBeCloseTo(
      REDIS_MONTHLY_COST_CEILING_USD,
      10
    )

    const at = (dailySubmissions: number) =>
      projectRedisCost({
        idleCommandsPerHour: 138,
        commandsPerPost: 82,
        dailySubmissions,
      })
    const { postsPerDayAtCostCeiling, projectedMonthly } = at(100)
    // 138 an hour for 730 hours is 100,740 idle commands, 0.20 USD; 82 a post
    // at 100 posts for 30.4 days is 249,280 commands, 0.50 USD.
    expect(projectedMonthly).toMatchObject({ idle: 100_740, traffic: 249_280 })
    expect(projectedMonthly!.idleUsd).toBeCloseTo(0.20148, 5)
    expect(projectedMonthly!.trafficUsd).toBeCloseTo(0.49856, 5)
    expect(projectedMonthly!.totalUsd).toBeCloseTo(0.70004, 5)
    // The ceiling volume stays at or below 5 USD; one more post a day crosses it.
    expect(at(postsPerDayAtCostCeiling!).projectedMonthly!.totalUsd).toBeLessThanOrEqual(
      5
    )
    expect(at(postsPerDayAtCostCeiling! + 1).projectedMonthly!.totalUsd).toBeGreaterThan(
      5
    )
    expect(
      projectRedisCost({
        idleCommandsPerHour: null,
        commandsPerPost: 82,
        dailySubmissions: 1,
      })
    ).toEqual({ postsPerDayAtCostCeiling: null, projectedMonthly: null })
  })

  it('computes the Wilson interval to published reference values', async () => {
    const { wilsonInterval } = await generator()
    const [low, high] = wilsonInterval(0, 200)
    expect(low).toBeCloseTo(0, 12)
    expect(high).toBeCloseTo(0.01884, 4)
    const [low2, high2] = wilsonInterval(10, 100)
    expect(low2).toBeCloseTo(0.05523, 4)
    expect(high2).toBeCloseTo(0.17437, 4)
    expect(wilsonInterval(0, 0)).toEqual([0, 1])
  })

  it('binds a hosted canary to a deployment whose inputs match the evidence commit', async () => {
    // Story 6.2b peer review (CX2), against a real repository.
    const { deployedInputBinding } = await generator()
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deployed-inputs-'))
    const run = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    const commit = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
      fs.writeFileSync(path.join(repo, file), text)
      run('add', '.')
      run('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', file)
      return run('rev-parse', 'HEAD')
    }
    try {
      run('init', '-q')
      const deployed = commit('src/worker.ts', 'v1')
      const docsOnly = commit('docs/readme.md', 'notes')
      const changed = commit('src/worker.ts', 'v2')
      const pathspecs = ['src']
      const bind = (expectedSha: unknown, commitSha: unknown) =>
        deployedInputBinding({ expectedSha, commitSha, pathspecs }, repo).status
      expect(bind(deployed, docsOnly)).toBe('same')
      expect(bind(deployed, changed)).toBe('differs')
      expect(bind('0123456789abcdef0123456789abcdef01234567', changed)).toBe('unknown')
      expect(bind('--output=/tmp/x', changed)).toBe('unknown')
      expect(bind(null, changed)).toBe('unknown')
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('treats a product without a current input-set hash as stale', async () => {
    const { inputStaleness } = await generator()
    expect(inputStaleness('a'.repeat(64), 'a'.repeat(64))).toEqual([])
    expect(inputStaleness('b'.repeat(64), 'a'.repeat(64))).toHaveLength(1)
    expect(inputStaleness(undefined, 'a'.repeat(64))).toHaveLength(1)
    expect(inputStaleness('unset', 'a'.repeat(64))).toHaveLength(1)
  })
})
