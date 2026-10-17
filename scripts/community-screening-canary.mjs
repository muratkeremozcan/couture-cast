/*
 * End-to-end canary for the deployed community moderation worker.
 *
 * Story 6.2b, AC 2. Proves that a worker is actually consuming
 * `community-moderation` against the target's Redis, PostgreSQL and storage,
 * that it screens with the real model, and how long that takes, by driving one
 * synthetic safe post through the same path a member's post takes after it is
 * submitted:
 *
 *   1. a namespaced canary account and one `pending_review` post are created,
 *      carrying a committed, manifest-pinned synthetic safe fixture uploaded to
 *      the private community bucket;
 *   2. one screening job is enqueued with the producer's own job id scheme and
 *      retention, exactly as the outbox dispatcher would;
 *   3. the post is polled until it leaves `pending_review`, inside a bounded
 *      wait;
 *   4. the BullMQ timestamps and the persisted engine identity are read back, and
 *      every row, object and job the canary created is removed.
 *
 * A hosted run refuses to start while the Community feed could be live: its
 * safe fixture publishes, and a published post is served by the feed. It needs
 * `community_read_enabled` to default to false in packages/config/src/flags.ts
 * and the production flag cache not to hold anything else.
 *
 * It exits nonzero, naming the cause, when no worker is consuming the queue,
 * when the persisted identity carries a `fixture` marker or comes from the
 * degraded `unavailable` adapter, when the safe fixture does not publish, or
 * when its deadline expires. One absolute deadline (`--timeout-ms`) covers every
 * network stage, from connecting to the closing job reads, and every client is
 * bounded on its own as well; cleanup runs under a deadline of its own
 * (`--cleanup-timeout-ms`). A run that hits either deadline force-closes its
 * connections, writes a failure report that includes the cleanup result, and
 * exits nonzero.
 *
 * It is an operations command, not a test, and it targets whatever environment
 * it is pointed at. `--target` is required and is checked against the database
 * host, so a canary labelled local cannot write to a hosted database and one
 * labelled hosted cannot quietly run against a laptop.
 *
 * Usage:
 *   node scripts/community-screening-canary.mjs --target local [--env-file .env.local]
 *   node scripts/community-screening-canary.mjs --target hosted --env-file <file>
 *   Hosted runs verify the database's TLS certificate (verify-full) against the
 *   Supabase Root 2021 CA committed at apps/api/certs/supabase-root-2021-ca.pem
 *   (--db-ca or DATABASE_CA_CERT_PATH name another), and require exactly one
 *   consumer named for --expect-sha (default: HEAD).
 *   A local run given --expect-sha requires the job to be processed by the worker
 *   named for it. A local run given --sole-consumer (which needs --expect-sha) also
 *   makes the hosted run's consumer check: exactly one consumer on the queue, named
 *   for that commit, checked before the job is enqueued and again after it
 *   completes, on the same Redis connection both times. The report records both
 *   observations as `soleConsumer`.
 *   Options: --timeout-ms <n> (default 120000), --cleanup-timeout-ms <n> (default
 *            30000), --json-out <path>, --keep,
 *            --fixture max (a generated 4096x4096 JPEG, the largest accepted upload),
 *            --restart-drill (local only: requires zero consumers on the queue, enqueues,
 *            observes zero consumers again with the job waiting, then waits for a
 *            consumer to return and the job to complete; the report records those
 *            observations and the observed downtime as `restartDrill`)
 */
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCommunityRolloutDefaults } from './lib/community-rollout-flags.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const QUEUE_NAME = 'community-moderation'
const JOB_NAME = 'community-moderation-screening'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60
const BUCKET = 'community-images'
const FIXTURE_DIRECTORY = 'apps/api/test/fixtures/community-moderation/v1'
/** The corpus's most confident safe fixture, measured Neutral 0.9991. */
const FIXTURE_NAME = 'safe-satin-plum-512x512.jpg'
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_CLEANUP_TIMEOUT_MS = 30_000
/** Per-client bounds, inside the run deadline (Story 6.2b final review, RF2). */
const DB_CONNECT_TIMEOUT_MS = 10_000
const DB_QUERY_TIMEOUT_MS = 15_000
const REDIS_CONNECT_TIMEOUT_MS = 10_000
const REDIS_COMMAND_TIMEOUT_MS = 15_000
/** How long a polite close may take before the sockets are dropped. */
const CLOSE_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 500
const TERMINAL_STATUSES = new Set(['published', 'flagged', 'review_failed'])
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'host.docker.internal'])
/** The Supabase Root 2021 CA, committed beside the worker image that carries it. */
export const COMMITTED_DATABASE_CA = path.join(
  projectRoot,
  'apps/api/certs/supabase-root-2021-ca.pem'
)
/** The canary account's id prefix; the API excludes it from analytics (community-analytics.ts). */
export const CANARY_USER_ID_PREFIX = 'canary-user-'
/** The BullMQ worker name the image gives itself (community-moderation.worker.ts). */
export const workerNameFor = (sha) => `community-worker@${sha}`

/** `new URL().hostname` keeps IPv6 brackets; host comparisons and clients need them gone. */
export function bareHostname(url) {
  return new URL(url).hostname.replace(/^\[(.*)\]$/, '$1')
}
/** Persisted identity markers that mean no real model screened the post. */
const NON_MODEL_MARKERS = ['fixture', 'unavailable', 'unresolved']

export class CanaryFailure extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CanaryFailure'
    this.code = code
    this.details = details
  }
}

const VALUE_FLAGS = {
  '--target': ['target', String],
  '--env-file': ['envFile', String],
  '--timeout-ms': ['timeoutMs', Number],
  '--cleanup-timeout-ms': ['cleanupTimeoutMs', Number],
  '--json-out': ['jsonOut', String],
  '--fixture': ['fixture', String],
  '--db-ca': ['dbCa', String],
  '--expect-sha': ['expectSha', String],
}
const SWITCH_FLAGS = {
  '--keep': ['keep', true],
  '--restart-drill': ['restartDrill', true],
  '--sole-consumer': ['soleConsumer', true],
}

function validateCanaryOptions(options) {
  if (options.target !== 'local' && options.target !== 'hosted') {
    throw new Error('--target must be local or hosted')
  }
  for (const [flag, key] of [
    ['--timeout-ms', 'timeoutMs'],
    ['--cleanup-timeout-ms', 'cleanupTimeoutMs'],
  ]) {
    if (!Number.isInteger(options[key]) || options[key] <= 0) {
      throw new Error(`${flag} must be a positive integer`)
    }
  }
  if (options.fixture !== 'safe' && options.fixture !== 'max') {
    throw new Error('--fixture must be safe or max')
  }
  validateConsumerOptions(options)
}

/** The options that decide how the canary checks which worker consumes. */
function validateConsumerOptions(options) {
  if (options.target === 'hosted' && !(options.dbCa && fs.existsSync(options.dbCa))) {
    throw new Error(
      `--target hosted verifies the database certificate against the Supabase CA, and ${String(options.dbCa)} does not exist (--db-ca or DATABASE_CA_CERT_PATH name another)`
    )
  }
  if (options.target === 'hosted' && options.restartDrill) {
    throw new Error(
      '--restart-drill stops the worker, so it runs against a local container only'
    )
  }
  if (options.soleConsumer && options.restartDrill) {
    throw new Error(
      '--sole-consumer needs the worker running before the job is enqueued, so it refuses --restart-drill'
    )
  }
  if (options.soleConsumer && options.target === 'local' && options.expectSha === null) {
    throw new Error(
      '--sole-consumer needs --expect-sha: the one consumer must be named for a known build'
    )
  }
}

export function parseCanaryArgs(argv) {
  const options = {
    target: null,
    envFile: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    cleanupTimeoutMs: DEFAULT_CLEANUP_TIMEOUT_MS,
    jsonOut: null,
    keep: false,
    restartDrill: false,
    fixture: 'safe',
    dbCa: process.env.DATABASE_CA_CERT_PATH ?? COMMITTED_DATABASE_CA,
    expectSha: null,
    soleConsumer: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (VALUE_FLAGS[arg]) {
      const [key, convert] = VALUE_FLAGS[arg]
      options[key] = convert(argv[++index])
    } else if (SWITCH_FLAGS[arg]) {
      const [key, value] = SWITCH_FLAGS[arg]
      options[key] = value
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  validateCanaryOptions(options)
  // A hosted run always proves which build consumed its job. A local run does
  // when it is told which build to expect, which is how the container memory
  // measurement proves the container it reads processed the upload.
  options.requireProcessedBy = options.target === 'hosted' || options.expectSha !== null
  // A hosted run always proves that one consumer, the expected one, was the only
  // one for the whole run. A local run does when asked, which is how the
  // container memory measurement proves the container it reads was the only
  // worker that could have screened the upload (Story 6.2b peer review, CX4b).
  options.soleConsumer = options.target === 'hosted' || options.soleConsumer
  return options
}

/**
 * Refuses a target label that disagrees with the database it would write to.
 * Ambiguity fails closed: the canary creates rows, and the one thing worse than
 * no canary is a canary that wrote test data where nobody expected it.
 */
export function assertTargetMatchesDatabase(target, databaseUrl) {
  if (!databaseUrl) {
    throw new CanaryFailure('configuration', 'DATABASE_URL is not set.')
  }
  let host
  try {
    host = bareHostname(databaseUrl)
  } catch {
    throw new CanaryFailure('configuration', 'DATABASE_URL is not a valid URL.')
  }
  const isLocal = LOCAL_HOSTS.has(host)
  if (target === 'local' && !isLocal) {
    throw new CanaryFailure(
      'configuration',
      `--target local refuses a non-local database host (${host}).`
    )
  }
  if (target === 'hosted' && isLocal) {
    throw new CanaryFailure(
      'configuration',
      `--target hosted refuses a local database host (${host}).`
    )
  }
  return host
}

/** The flag that serves the feed the canary's synthetic post would publish into. */
const FEED_FLAG = 'community_read_enabled'

/**
 * Why a hosted canary must not run against this feed, or null when it may. The
 * canary's safe fixture publishes, and a published post is served by the feed,
 * so a hosted run waits until nobody can be reading it (Story 6.2b final
 * review, RF5): the flag's code default must be false, and the production
 * flag cache (`feature_flags`, which the API keeps warm with PostHog's answer
 * and falls back to before the code default) must not hold anything else.
 */
export function liveFeedRefusal({ codeDefault, cachedValue }) {
  if (codeDefault !== false) {
    return `${FEED_FLAG} defaults to ${String(codeDefault)} in packages/config/src/flags.ts, so the feed may be live and the canary's post would be served in it.`
  }
  if (cachedValue !== undefined && cachedValue !== false) {
    return `The production flag cache holds ${FEED_FLAG} = ${JSON.stringify(cachedValue)}, so the feed may be live and the canary's post would be served in it.`
  }
  return null
}

function refuseLiveFeed(state) {
  const refusal = liveFeedRefusal(state)
  if (refusal) throw new CanaryFailure('feed_live', refusal, state)
}

async function cachedFeedFlag(db) {
  const { rows } = await db.query('SELECT value FROM feature_flags WHERE key = $1', [
    FEED_FLAG,
  ])
  return rows.length > 0 ? rows[0].value : undefined
}

/**
 * Classifies what the worker persisted. A safe fixture must publish under a real
 * model identity; anything else is a canary failure with a named cause.
 */
export function assessTerminalPost(post) {
  const identity = post.moderation_engine_version ?? ''
  const marker = NON_MODEL_MARKERS.find((value) => identity.includes(value))
  if (!identity) {
    throw new CanaryFailure(
      'identity_missing',
      `The post reached ${post.status} with no persisted engine identity.`
    )
  }
  if (marker) {
    throw new CanaryFailure(
      'not_a_real_model',
      `The persisted engine identity carries the "${marker}" marker, so no real model screened the canary.`,
      { engineIdentity: identity }
    )
  }
  if (post.status !== 'published') {
    throw new CanaryFailure(
      'safe_fixture_withheld',
      `The safe canary fixture reached ${post.status} (${post.moderation_reason ?? 'no reason'}) instead of publishing.`,
      { engineIdentity: identity, moderationReason: post.moderation_reason ?? null }
    )
  }
  return { disposition: 'pass', engineIdentity: identity }
}

function loadEnvFile(envFile) {
  if (!envFile) return
  const resolved = path.resolve(projectRoot, envFile)
  if (!fs.existsSync(resolved)) {
    throw new CanaryFailure('configuration', `Env file not found: ${envFile}`)
  }
  for (const line of fs.readFileSync(resolved, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match || line.trimStart().startsWith('#')) continue
    const [, key, raw] = match
    // The shell wins over the file, so an operator can override one value.
    if (process.env[key] !== undefined) continue
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2')
  }
}

/**
 * The producer's Redis options. Every wait is bounded (Story 6.2b final review,
 * RF2): a TCP connect gives up after `connectTimeout`, a command that gets no
 * reply fails after `commandTimeout`, a command waiting for a lost connection
 * fails after two reconnect attempts, and reconnection itself stops after three.
 * A worker's connection needs `maxRetriesPerRequest: null` to block on Redis;
 * this one is a producer and never blocks.
 */
export function redisOptions(
  redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
) {
  const url = new URL(redisUrl)
  const options = {
    host: bareHostname(redisUrl),
    port: url.port ? Number(url.port) : 6379,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 2,
    retryStrategy: (attempt) => (attempt > 3 ? null : attempt * 250),
    lazyConnect: true,
  }
  if (url.password) options.password = decodeURIComponent(url.password)
  if (url.username && url.username !== 'default') {
    options.username = decodeURIComponent(url.username)
  }
  if (url.protocol === 'rediss:' || process.env.REDIS_TLS === 'true') options.tls = {}
  return options
}

/**
 * The largest upload the pipeline accepts: 4096 pixels square, under the 10 MB
 * ceiling. It exists so a memory measurement sees the worst decode the worker
 * will ever be handed, not a 40 KB swatch.
 */
async function generateMaxFixture() {
  const { default: sharp } = await import('sharp')
  const size = 4096
  const raw = Buffer.alloc(size * size * 3)
  for (let index = 0; index < raw.length; index += 3) {
    const pixel = index / 3
    const x = pixel % size
    const y = Math.floor(pixel / size)
    raw[index] = (x * 7 + y * 3) % 256
    raw[index + 1] = (x * 2 + y * 5) % 256
    raw[index + 2] = (x + y) % 256
  }
  const bytes = await sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer()
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  return { bytes, sha256, contentType: 'image/jpeg', name: 'generated-4096x4096.jpg' }
}

function readFixture() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, FIXTURE_DIRECTORY, 'manifest.json'), 'utf8')
  )
  const entry = manifest.files.find((file) => file.path === FIXTURE_NAME)
  if (!entry) {
    throw new CanaryFailure(
      'configuration',
      `${FIXTURE_NAME} is not in the fixture manifest.`
    )
  }
  const bytes = fs.readFileSync(path.join(projectRoot, FIXTURE_DIRECTORY, FIXTURE_NAME))
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== entry.sha256 || bytes.length !== entry.byteSize) {
    throw new CanaryFailure(
      'configuration',
      `${FIXTURE_NAME} drifted from its pinned hash.`
    )
  }
  return { bytes, sha256, contentType: entry.contentType, name: FIXTURE_NAME }
}

/**
 * Asks Redis which clients are subscribed as workers. BullMQ names every worker
 * connection, so an empty list is a definite "nobody is consuming". Some managed
 * Redis services do not implement CLIENT LIST; then the answer is unknown and the
 * bounded wait decides, which is why a job that never leaves `waiting` is
 * reported as an absent worker rather than as a timeout.
 */
async function countWorkers(queue) {
  try {
    const workers = await queue.getWorkers()
    return {
      known: true,
      count: workers.length,
      names: workers.map((worker) => worker.rawname ?? worker.name ?? null),
      clientIds: workers.map((worker) => worker.id ?? null),
      observedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      known: false,
      count: null,
      note: `CLIENT LIST unavailable: ${error instanceof Error ? error.message : String(error)}`,
      observedAt: new Date().toISOString(),
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs one network stage of the canary, or rejects with a `deadline` failure
 * naming the stage when the run's absolute deadline passes first (Story 6.2b
 * final review, RF2). The losing operation is not cancelled here; the caller
 * force-closes the clients, which is what makes a stalled socket give up.
 */
export async function withinDeadline(deadlineAt, stage, work, label = 'canary') {
  const remainingMs = deadlineAt - Date.now()
  if (remainingMs <= 0) {
    throw new CanaryFailure(
      'deadline',
      `The ${label} deadline passed before the ${stage} stage started.`,
      { stage }
    )
  }
  let timer
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new CanaryFailure(
          'deadline',
          `The ${stage} stage did not finish before the ${label} deadline; the clients were force-closed.`,
          { stage }
        )
      )
    }, remainingMs)
  })
  try {
    return await Promise.race([Promise.resolve().then(work), expiry])
  } finally {
    clearTimeout(timer)
  }
}

async function createCanaryRows(db, ids, fixture, objectPath) {
  const now = new Date()
  await db.query(
    'INSERT INTO "User" (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
    [ids.userId, ids.email, now]
  )
  await db.query(
    `INSERT INTO "LookbookPost" (
       id, user_id, status, caption, alt_text, alt_text_confirmed_at, submitted_at,
       image_object_path, image_content_type, image_checksum, image_byte_size,
       locale, created_at, updated_at
     ) VALUES ($1, $2, 'pending_review', $3, $4, $5, $5, $6, $7, $8, $9, 'en-US', $5, $5)`,
    [
      ids.postId,
      ids.userId,
      'Plum satin for a mild evening.',
      'A swatch of plum satin fabric.',
      now,
      objectPath,
      fixture.contentType,
      fixture.sha256,
      fixture.bytes.length,
    ]
  )
}

async function readPost(db, postId) {
  const { rows } = await db.query(
    `SELECT status, moderation_reason, moderation_engine_version, published_at
       FROM "LookbookPost" WHERE id = $1`,
    [postId]
  )
  return rows[0] ?? null
}

/**
 * What the canary may have left behind: each flag is set before the operation
 * that creates the thing starts, so a write cut off by the deadline still gets
 * cleaned up, and nothing the run never attempted is touched.
 */
function createdNothing() {
  return { object: false, rows: false, job: false }
}

async function removeCreated({ db, storage, queue, ids, objectPath, jobId, created }) {
  const problems = []
  const attempt = async (label, work) => {
    try {
      await work()
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (created.job) {
    await attempt('job', async () => {
      const job = await queue.getJob(jobId)
      if (job) await job.remove()
    })
  }
  if (created.rows) {
    // Moderation events first: their post reference is SET NULL on delete, so
    // deleting the post first would orphan a content snapshot no sweep collects.
    await attempt('moderation events', () =>
      db.query('DELETE FROM "ModerationEvent" WHERE post_id = $1', [ids.postId])
    )
    // The user delete cascades to the post, its outbox row and any telemetry row
    // the publication wrote.
    await attempt('canary account', () =>
      db.query('DELETE FROM "User" WHERE id = $1', [ids.userId])
    )
  }
  if (created.object) {
    await attempt('storage object', async () => {
      const { error } = await storage.from(BUCKET).remove([objectPath])
      if (error) throw new Error(error.message)
    })
  }
  return problems
}

/** Names what a cleanup that could not finish may have left, for the report. */
function leftBehind(context) {
  const { ids, objectPath, jobId, created } = context
  return [
    created.job ? `job ${jobId}` : null,
    created.rows ? `account ${ids.userId} and post ${ids.postId}` : null,
    created.object ? `object ${BUCKET}/${objectPath}` : null,
  ].filter(Boolean)
}

/**
 * Removes what the run created, under its own deadline. After a run deadline
 * the run's clients are already force-closed, so cleanup opens fresh ones: the
 * network may have recovered, and the rows and the object are still worth
 * removing. When cleanup cannot finish either, its clients are force-closed and
 * the problem names what may remain.
 */
async function cleanupWithin(context, options, { freshClients }) {
  if (!Object.values(context.created).some(Boolean)) return []
  let clients = context.clients
  const deadlineAt = Date.now() + options.cleanupTimeoutMs
  try {
    if (freshClients) clients = await options.openClients(options)
    return await withinDeadline(
      deadlineAt,
      'cleanup',
      async () => {
        await connectDatabase(clients.db)
        return removeCreated({ ...context, ...clients })
      },
      'cleanup'
    )
  } catch (error) {
    if (clients) forceClose(clients)
    return [
      `${error instanceof Error ? error.message : String(error)} It may have left: ${leftBehind(context).join(', ')}.`,
    ]
  } finally {
    if (freshClients && clients) await closeClients(clients)
  }
}

function requireStorageCredentials() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new CanaryFailure(
      'configuration',
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to upload the canary fixture.'
    )
  }
  return { supabaseUrl, serviceRoleKey }
}

function canaryIdentifiers() {
  const runId = `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
  const ids = {
    userId: `${CANARY_USER_ID_PREFIX}${runId}`,
    email: `community-canary+${runId}@couturecast.invalid`,
    postId: `canary-post-${runId}`,
    uploadSessionId: `canary-upload-${runId}`,
  }
  return {
    ids,
    objectPath: `community/${ids.postId}/${crypto.randomBytes(12).toString('hex')}.jpg`,
    jobId: `${ids.postId}__${ids.uploadSessionId}`,
  }
}

/**
 * The connection string with every libpq SSL parameter removed. pg parses the
 * connection string after it receives the explicit `ssl` object, and any of these
 * replaces it: `sslmode=require` drops the CA, `sslmode=no-verify` turns
 * verification off and `sslmode=disable` turns TLS off. The deployment guide keeps
 * Supabase's `sslmode=require` in DATABASE_URL, so a hosted canary would
 * otherwise never verify the certificate it claims to.
 */
export function withoutSslParameters(databaseUrl) {
  const url = new URL(databaseUrl)
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('ssl')) url.searchParams.delete(key)
  }
  return url.toString()
}

/**
 * The PostgreSQL client for a target. Connecting and every query are bounded
 * (`connectionTimeoutMillis`, `query_timeout`), so a database that accepts the
 * connection and never answers fails the stage instead of holding it. A hosted
 * client verifies the server certificate against the Supabase CA and the host
 * name (verify-full), and the effective configuration pg resolved is checked
 * before anything connects.
 */
export function createDatabaseClient(pg, { target, databaseUrl, ca }) {
  const bounds = {
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    query_timeout: DB_QUERY_TIMEOUT_MS,
  }
  if (target !== 'hosted')
    return new pg.Client({ connectionString: databaseUrl, ...bounds })
  const client = new pg.Client({
    connectionString: withoutSslParameters(databaseUrl),
    ssl: { ca, rejectUnauthorized: true },
    ...bounds,
  })
  const effective = client.connectionParameters?.ssl
  if (
    typeof effective !== 'object' ||
    effective === null ||
    effective.rejectUnauthorized !== true ||
    effective.ca !== ca
  ) {
    throw new CanaryFailure(
      'configuration',
      'The hosted database connection would not verify the server certificate against the Supabase CA.'
    )
  }
  return client
}

/**
 * Opens the run's clients: PostgreSQL, Redis behind the BullMQ queue, and
 * storage, whose requests share one abort signal. Nothing here waits on the
 * network; each connection is made inside a bounded stage.
 */
export async function openClients(options) {
  const { supabaseUrl, serviceRoleKey } = requireStorageCredentials()
  const { default: pg } = await import('pg')
  const { default: Redis } = await import('ioredis')
  const { Queue } = await import('bullmq')
  const { createClient } = await import('@supabase/supabase-js')
  const abort = new AbortController()
  const db = createDatabaseClient(pg, {
    target: options.target,
    databaseUrl: process.env.DATABASE_URL,
    ca: options.target === 'hosted' ? fs.readFileSync(options.dbCa, 'utf8') : null,
  })
  // A destroyed socket surfaces as an 'error' event; the failure is already
  // reported by the stage that was waiting on it.
  db.on('error', () => undefined)
  const redis = new Redis(redisOptions())
  redis.on('error', () => undefined)
  // The queue borrows the connection, so force-closing `redis` is what stops a
  // stalled command.
  const queue = new Queue(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  })
  queue.on('error', () => undefined)
  return {
    db,
    redis,
    abort,
    storage: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init = {}) =>
          fetch(input, {
            ...init,
            signal: init.signal
              ? AbortSignal.any([init.signal, abort.signal])
              : abort.signal,
          }),
      },
    }).storage,
    queue,
  }
}

/** Connects the database once, so cleanup can wait on the same connection. */
function connectDatabase(db) {
  db.connected ??= db.connect()
  return db.connected
}

/** Drops every socket now, without waiting for a reply from anything stalled. */
export function forceClose({ db, redis, abort }) {
  try {
    abort?.abort()
  } catch {
    // already aborted
  }
  try {
    // `disconnect` only half-closes the socket, which a peer that never answers
    // never finishes; destroying the stream is what drops it.
    redis?.disconnect(false)
    redis?.stream?.destroy()
  } catch {
    // already closed
  }
  try {
    db?.connection?.stream?.destroy()
  } catch {
    // already closed
  }
}

/** Closes the clients politely, and force-closes whatever does not close in time. */
async function closeClients(clients) {
  const politely = Promise.allSettled([
    clients.queue.close(),
    clients.redis.quit(),
    clients.db.end(),
  ])
  const outcome = await Promise.race([
    politely.then(() => 'closed'),
    sleep(CLOSE_TIMEOUT_MS).then(() => 'stalled'),
  ])
  if (outcome === 'stalled') forceClose(clients)
}

/**
 * Whether one observation of the queue's consumers shows exactly one consumer,
 * named for the expected build, on a connection Redis identified. Returns the
 * problems, empty when it does.
 */
export function soleConsumerProblems(workers, expectedWorker) {
  if (!workers?.known) return ['Redis reported no client list']
  const problems = []
  if (workers.count !== 1 || workers.names?.length !== 1) {
    problems.push(
      `${String(workers.count)} consumers: ${JSON.stringify(workers.names ?? [])}`
    )
  } else if (!workers.names[0]?.endsWith(`:w:${expectedWorker}`)) {
    problems.push(`the consumer is ${String(workers.names[0])}, not ${expectedWorker}`)
  }
  if (workers.clientIds?.length !== 1 || !workers.clientIds[0]) {
    problems.push('the consumer connection has no Redis client id')
  }
  return problems
}

/**
 * The proof that one consumer, the expected one, was the only consumer for the
 * whole run: exactly one consumer named `expectedWorker` before the job was
 * enqueued and after it completed, and the same Redis connection both times. A
 * second consumer that connected and left again between the two observations
 * would also have to beat the expected worker to the job and carry its name,
 * and the job's `processedBy` is checked separately.
 */
export function assessSoleConsumer(before, after, expectedWorker) {
  const problems = [
    ...soleConsumerProblems(before, expectedWorker).map(
      (problem) => `before: ${problem}`
    ),
    ...soleConsumerProblems(after, expectedWorker).map((problem) => `after: ${problem}`),
  ]
  if (problems.length === 0 && before.clientIds[0] !== after.clientIds[0]) {
    problems.push(
      `the consumer connection changed from client ${before.clientIds[0]} to ${after.clientIds[0]}`
    )
  }
  return {
    proven: problems.length === 0,
    expectedWorker,
    before: before ?? null,
    after: after ?? null,
    problems,
  }
}

async function precheckWorkers(workers, options) {
  if (options.restartDrill) {
    // The drill's premise: nobody is consuming when the job is queued.
    if (!workers.known) {
      throw new CanaryFailure(
        'restart_drill_unobservable',
        `The restart drill needs Redis to list its clients, to prove the worker was down when the job was queued (${workers.note}).`
      )
    }
    if (workers.count !== 0) {
      throw new CanaryFailure(
        'worker_present',
        `The restart drill found ${workers.count} consumer(s) on ${QUEUE_NAME} (${JSON.stringify(workers.names)}). Stop the worker first, then start the drill.`
      )
    }
    return workers
  }
  if (workers.known && workers.count === 0) {
    throw new CanaryFailure(
      'worker_absent',
      `No worker is connected to the ${QUEUE_NAME} queue on this Redis.`
    )
  }
  if (options.soleConsumer) {
    // Exactly one consumer, and the one built from the commit under test. A
    // second consumer would take some jobs and its identity would go unproven.
    const expected = workerNameFor(options.expectSha)
    const problems = soleConsumerProblems(workers, expected)
    if (problems.length > 0) {
      throw new CanaryFailure(
        'worker_identity',
        `The ${options.target} canary needs exactly one consumer named ${expected}; Redis reported ${workers.known ? JSON.stringify(workers.names) : 'no client list'}.`,
        { expectedWorker: expected, problems }
      )
    }
  }
  return workers
}

/** Repeats the consumer check after the job completed, against the first one. */
async function postcheckSoleConsumer(after, options, before) {
  if (!options.soleConsumer) return null
  const expected = workerNameFor(options.expectSha)
  const proof = assessSoleConsumer(before, after, expected)
  if (!proof.proven) {
    throw new CanaryFailure(
      'worker_identity',
      `The ${options.target} canary could not prove ${expected} was the only consumer for the whole run: ${proof.problems.join('; ')}.`,
      { soleConsumer: proof }
    )
  }
  return proof
}

async function uploadFixture(storage, objectPath, fixture) {
  const upload = await storage.from(BUCKET).upload(objectPath, fixture.bytes, {
    contentType: fixture.contentType,
    upsert: false,
  })
  if (upload.error) {
    throw new CanaryFailure(
      'configuration',
      `Fixture upload failed: ${upload.error.message}`
    )
  }
}

/**
 * The restart drill's record of what it saw (Story 6.2b final review, RF1):
 * zero consumers before the job was enqueued, zero again after it with the job
 * still waiting, then the first observation of a consumer that came back. The
 * observed downtime runs from the first zero-consumer observation to the last
 * one, so it is a lower bound on the real outage.
 */
function restartDrillRecord(drill) {
  const at = (observation) => Date.parse(observation?.observedAt ?? '')
  return {
    beforeEnqueue: drill.beforeEnqueue,
    afterEnqueue: drill.afterEnqueue,
    lastDownObservedAt: drill.lastDown?.observedAt ?? null,
    consumerReturned: drill.returned,
    observedDowntimeMs: at(drill.lastDown) - at(drill.beforeEnqueue),
    observedDowntimeCovers:
      'from the zero-consumer observation before the job was enqueued to the last zero-consumer observation, a lower bound on the outage',
  }
}

/**
 * Why a restart drill record does not prove a job queued while no worker ran
 * completed once one came back, empty when it does. The readiness gate judges
 * the recorded observations with this same rule, so an ordinary canary result,
 * which carries none, is never restart evidence.
 */
export function restartDrillProblems(record) {
  if (!record || typeof record !== 'object') return ['no restart drill observations']
  const problems = []
  const { beforeEnqueue, afterEnqueue, consumerReturned } = record
  if (beforeEnqueue?.known !== true || beforeEnqueue.count !== 0) {
    problems.push('zero consumers were not observed before the job was enqueued')
  }
  if (
    afterEnqueue?.known !== true ||
    afterEnqueue.count !== 0 ||
    afterEnqueue.jobState !== 'waiting'
  ) {
    problems.push(
      'zero consumers with the job waiting were not observed after the job was enqueued'
    )
  }
  if (consumerReturned?.known !== true || !(consumerReturned.count >= 1)) {
    problems.push('no consumer was observed coming back')
  } else if (
    !(Date.parse(consumerReturned.observedAt) > Date.parse(afterEnqueue?.observedAt))
  ) {
    problems.push('the returning consumer was not observed after the job was queued')
  }
  if (!Number.isFinite(record.observedDowntimeMs) || record.observedDowntimeMs <= 0) {
    problems.push(`observed downtime ${String(record.observedDowntimeMs)} ms`)
  }
  return problems
}

/** One poll of the drill: is anyone consuming yet, and was the job still waiting? */
async function observeRestart(step, queue, jobId, drill) {
  if (drill.returned) return
  const workers = await step('worker inspection', () => countWorkers(queue))
  if (workers.known && workers.count > 0) {
    drill.returned = workers
    return
  }
  const job = await step('job read', () => queue.getJob(jobId))
  const jobState = job ? await step('job read', () => job.getState()) : 'missing'
  drill.lastDown = { ...workers, jobState }
}

/**
 * Polls the post until it leaves pending_review or the poll window closes. The
 * window ends a reserve before the run deadline, so the job reads that explain
 * the outcome still fit inside it.
 */
async function awaitTerminalPost(step, db, postId, pollUntil, onPoll) {
  let post = await step('polling', () => readPost(db, postId))
  while (!TERMINAL_STATUSES.has(post?.status) && Date.now() < pollUntil) {
    await onPoll?.()
    await sleep(POLL_INTERVAL_MS)
    post = await step('polling', () => readPost(db, postId))
  }
  return post
}

/** Names why a post never reached a terminal state, from what the job did. */
function nonTerminalFailure(post, job, jobState, timeoutMs) {
  if (jobState === 'waiting' || jobState === 'prioritized') {
    return new CanaryFailure(
      'worker_absent',
      `The job stayed ${jobState} for the ${timeoutMs} ms run, so no worker picked it up.`,
      { jobState }
    )
  }
  return new CanaryFailure(
    'timeout',
    `The post was still ${post?.status ?? 'missing'} at the end of the ${timeoutMs} ms run (job ${jobState}).`,
    { jobState, attemptsMade: job?.attemptsMade ?? null }
  )
}

function jobTimings(job, enqueuedAt, observedTerminalAt) {
  const has = (value) => typeof value === 'number' && value > 0
  return {
    queueLatencyMs:
      has(job?.processedOn) && has(job?.timestamp)
        ? job.processedOn - job.timestamp
        : null,
    screeningDurationMs:
      has(job?.finishedOn) && has(job?.processedOn)
        ? job.finishedOn - job.processedOn
        : null,
    screeningDurationCovers:
      'BullMQ processedOn to finishedOn: storage download, declaration check and re-encode, image inference, text screening, and the publish transaction',
    enqueueToObservedTerminalMs: observedTerminalAt - enqueuedAt,
    pollIntervalMs: POLL_INTERVAL_MS,
  }
}

/** How long before the run deadline polling stops, so the closing reads fit. */
export function closingReserveMs(timeoutMs) {
  return Math.min(5_000, Math.floor(timeoutMs / 4))
}

/** Connects, refuses a live feed, and checks who is consuming before anything is created. */
async function openAndInspect(step, { db, queue }, options) {
  await step('connect', () => connectDatabase(db))
  await step('connect', () => queue.waitUntilReady())
  if (options.target === 'hosted') {
    refuseLiveFeed({
      codeDefault: readCommunityRolloutDefaults().communityReadEnabled,
      cachedValue: await step('connect', () => cachedFeedFlag(db)),
    })
  }
  return precheckWorkers(
    await step('worker inspection', () => countWorkers(queue)),
    options
  )
}

/** Uploads the fixture, writes the rows and enqueues the job, marking each first. */
async function createAndEnqueue(step, context) {
  const { ids, objectPath, jobId, fixture, created } = context
  const { db, storage, queue } = context.clients
  created.object = true
  await step('upload', () => uploadFixture(storage, objectPath, fixture))
  created.rows = true
  await step('database write', () => createCanaryRows(db, ids, fixture, objectPath))
  created.job = true
  await step('enqueue', () =>
    queue.add(
      JOB_NAME,
      { postId: ids.postId, uploadSessionId: ids.uploadSessionId },
      {
        jobId,
        removeOnComplete: { age: JOB_RETENTION_SECONDS },
        removeOnFail: { age: JOB_RETENTION_SECONDS },
      }
    )
  )
}

/** Polls to a terminal post, observing the drill on the way, and reads the job back. */
async function awaitOutcome(step, context, options, drill) {
  const { ids, jobId } = context
  const { db, queue } = context.clients
  if (drill) {
    await observeRestart(step, queue, jobId, drill)
    drill.afterEnqueue = drill.lastDown ?? drill.returned
  }
  const post = await awaitTerminalPost(
    step,
    db,
    ids.postId,
    context.deadlineAt - closingReserveMs(options.timeoutMs),
    drill ? () => observeRestart(step, queue, jobId, drill) : null
  )
  const observedTerminalAt = Date.now()
  const job = await step('job read', () => queue.getJob(jobId))
  const jobState = job ? await step('job read', () => job.getState()) : 'missing'
  if (!TERMINAL_STATUSES.has(post?.status)) {
    throw nonTerminalFailure(post, job, jobState, options.timeoutMs)
  }
  return { post, job, jobState, observedTerminalAt }
}

/**
 * The consumer observation after the job completed: needed for the sole-consumer
 * proof, and for a drill whose returning worker finished the job between polls.
 */
async function closingConsumers(step, queue, options, drill) {
  if (!options.soleConsumer && !(drill && !drill.returned)) return null
  const after = await step('worker inspection', () => countWorkers(queue))
  if (drill && !drill.returned && after.known && after.count > 0) drill.returned = after
  return after
}

function assertRestartDrillProven(record) {
  const problems = restartDrillProblems(record)
  if (problems.length > 0) {
    throw new CanaryFailure(
      'restart_drill_unproven',
      `The restart drill could not prove the job waited for a restarted worker: ${problems.join('; ')}.`,
      { restartDrill: record }
    )
  }
}

function assertProcessedBy(processedBy, options) {
  if (options.requireProcessedBy && processedBy !== workerNameFor(options.expectSha)) {
    throw new CanaryFailure(
      'worker_identity',
      `The canary job was processed by ${String(processedBy)}, not ${workerNameFor(options.expectSha)}.`
    )
  }
}

async function driveCanary(context, options) {
  const { fixture } = context
  const { queue } = context.clients
  const step = (stage, work) => withinDeadline(context.deadlineAt, stage, work)

  const workers = await openAndInspect(step, context.clients, options)
  await createAndEnqueue(step, context)
  const enqueuedAt = Date.now()
  const drill = options.restartDrill ? { beforeEnqueue: workers } : null
  const { post, job, jobState, observedTerminalAt } = await awaitOutcome(
    step,
    context,
    options,
    drill
  )

  const assessed = assessTerminalPost(post)
  const after = await closingConsumers(step, queue, options, drill)
  const soleConsumer = await postcheckSoleConsumer(after, options, workers)
  const restartDrill = drill ? restartDrillRecord(drill) : null
  if (restartDrill) assertRestartDrillProven(restartDrill)
  const processedBy = job?.processedBy ?? null
  assertProcessedBy(processedBy, options)
  const { inputSetHash } = await import('./lib/community-screening-input-set.mjs')
  return {
    ok: true,
    mode: options.restartDrill ? 'restart-drill' : 'canary',
    target: options.target,
    inputSetHash: inputSetHash(),
    expectedSha: options.expectSha,
    processedByRequired: options.requireProcessedBy === true,
    processedBy,
    soleConsumerRequired: options.soleConsumer === true,
    soleConsumer,
    ...(restartDrill ? { restartDrill } : {}),
    startedAt: context.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    fixture: { name: fixture.name, sha256: fixture.sha256, bytes: fixture.bytes.length },
    workersConnected: workers,
    terminalStatus: post.status,
    disposition: assessed.disposition,
    engineIdentity: assessed.engineIdentity,
    attemptsMade: job?.attemptsMade ?? null,
    jobState,
    timings: jobTimings(job, enqueuedAt, observedTerminalAt),
  }
}

/**
 * Records what cleanup did on the report. A canary that left rows, an object or
 * a job behind did not pass, and the report says so itself, so no reader has to
 * know to look at the cleanup block.
 */
export function recordCleanup(report, { keep, problems }) {
  report.cleanup = keep
    ? { performed: false, note: '--keep left the canary rows, object and job in place' }
    : { performed: true, problems }
  if (problems.length > 0 && report.ok !== false) {
    report.ok = false
    report.code = 'cleanup_failed'
    report.message = `Cleanup left canary data behind: ${problems.join('; ')}`
  }
  return report
}

/**
 * Runs the canary under one absolute deadline (`--timeout-ms`, from the moment
 * it starts connecting) that covers connecting, inspecting the workers,
 * uploading, writing, enqueueing, polling and the closing job reads. When the
 * deadline passes, the clients are force-closed, cleanup runs under its own
 * deadline (`--cleanup-timeout-ms`) on fresh clients, and the failure carries
 * the cleanup result. Every failure is a CanaryFailure with `cleanup` set.
 */
export async function runCanary(options) {
  loadEnvFile(options.envFile)
  assertTargetMatchesDatabase(options.target, process.env.DATABASE_URL)
  if (options.target === 'hosted') {
    // Checked again against the production flag cache once the database is open.
    refuseLiveFeed({ codeDefault: readCommunityRolloutDefaults().communityReadEnabled })
  }
  options.expectSha ??= gitHeadSha()
  options.openClients ??= openClients
  options.cleanupTimeoutMs ??= DEFAULT_CLEANUP_TIMEOUT_MS
  const fixture = options.fixture === 'max' ? await generateMaxFixture() : readFixture()
  const clients = await options.openClients(options)
  const startedAt = new Date()
  const context = {
    clients,
    ...canaryIdentifiers(),
    fixture,
    startedAt,
    deadlineAt: startedAt.getTime() + options.timeoutMs,
    created: createdNothing(),
  }

  let report
  let failure
  try {
    report = await driveCanary(context, options)
  } catch (error) {
    failure =
      error instanceof CanaryFailure
        ? error
        : new CanaryFailure(
            'error',
            error instanceof Error ? error.message : String(error)
          )
  }
  const deadlineExpired = failure?.code === 'deadline'
  if (deadlineExpired) forceClose(clients)
  const problems = options.keep
    ? []
    : await cleanupWithin(context, options, { freshClients: deadlineExpired })
  if (problems.length > 0) {
    // Printed whether or not the run produced a report: a failed canary that
    // also left rows or an object behind must say so.
    console.error(`[canary] cleanup problems: ${problems.join('; ')}`)
  }
  if (!deadlineExpired) await closeClients(clients)
  if (failure) {
    failure.cleanup = recordCleanup(
      { ok: false },
      { keep: options.keep, problems }
    ).cleanup
    throw failure
  }
  return recordCleanup(report, { keep: options.keep, problems })
}

function gitHeadSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function writeJson(filePath, value) {
  const resolved = path.resolve(projectRoot, filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`)
}

/** The report a failed run writes: the cause, the cleanup, and the run's identity. */
export async function failureReport(error, options) {
  const failure =
    error instanceof CanaryFailure
      ? { ok: false, code: error.code, message: error.message, details: error.details }
      : {
          ok: false,
          code: 'error',
          message: error instanceof Error ? error.message : String(error),
        }
  if (error?.cleanup) failure.cleanup = error.cleanup
  failure.mode = options.restartDrill ? 'restart-drill' : 'canary'
  failure.target = options.target
  // The same identity a passing report carries, so the readiness gate judges
  // a failure as failed rather than discarding it as stale.
  failure.expectedSha = options.expectSha ?? null
  const { inputSetHash } = await import('./lib/community-screening-input-set.mjs')
  failure.inputSetHash = inputSetHash()
  failure.finishedAt = new Date().toISOString()
  return failure
}

async function main() {
  let options
  try {
    options = parseCanaryArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[canary] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }

  try {
    const report = await runCanary(options)
    if (options.jsonOut) writeJson(options.jsonOut, report)
    console.log(JSON.stringify(report, null, 2))
    if (report.ok !== true) {
      console.error(`[canary] FAIL ${report.code}: ${report.message}`)
      process.exit(1)
    }
    console.log(
      `[canary] PASS ${report.target}: ${report.disposition} under ${report.engineIdentity}; queue latency ${report.timings.queueLatencyMs} ms, screening ${report.timings.screeningDurationMs} ms`
    )
    process.exit(0)
  } catch (error) {
    const failure = await failureReport(error, options)
    if (options.jsonOut) writeJson(options.jsonOut, failure)
    console.error(JSON.stringify(failure, null, 2))
    console.error(`[canary] FAIL ${failure.code}: ${failure.message}`)
    process.exit(1)
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  void main()
}
