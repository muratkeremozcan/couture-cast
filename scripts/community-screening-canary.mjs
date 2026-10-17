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
 * It exits nonzero, naming the cause, when no worker is consuming the queue,
 * when the persisted identity carries a `fixture` marker or comes from the
 * degraded `unavailable` adapter, when the safe fixture does not publish, or
 * when the wait expires.
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
 *   Supabase CA: pass --db-ca <path to prod-ca-2021.crt> or set DATABASE_CA_CERT_PATH,
 *   and require exactly one consumer named for --expect-sha (default: HEAD).
 *   A local run given --expect-sha requires the job to be processed by the worker
 *   named for it.
 *   Options: --timeout-ms <n> (default 120000), --json-out <path>, --keep,
 *            --fixture max (a generated 4096x4096 JPEG, the largest accepted upload),
 *            --no-worker-precheck (restart drill: enqueue while the worker is down,
 *            then start it, and the job must still complete)
 */
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
const POLL_INTERVAL_MS = 500
const TERMINAL_STATUSES = new Set(['published', 'flagged', 'review_failed'])
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'host.docker.internal'])
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
  '--json-out': ['jsonOut', String],
  '--fixture': ['fixture', String],
  '--db-ca': ['dbCa', String],
  '--expect-sha': ['expectSha', String],
}
const SWITCH_FLAGS = {
  '--keep': ['keep', true],
  '--no-worker-precheck': ['workerPrecheck', false],
}

function validateCanaryOptions(options) {
  if (options.target !== 'local' && options.target !== 'hosted') {
    throw new Error('--target must be local or hosted')
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer')
  }
  if (options.fixture !== 'safe' && options.fixture !== 'max') {
    throw new Error('--fixture must be safe or max')
  }
  if (options.target === 'hosted' && !options.dbCa) {
    throw new Error(
      '--target hosted needs the Supabase CA (--db-ca or DATABASE_CA_CERT_PATH): the database certificate is verified, never trusted blindly'
    )
  }
  if (options.target === 'hosted' && !options.workerPrecheck) {
    throw new Error('--target hosted always checks which worker is consuming')
  }
}

export function parseCanaryArgs(argv) {
  const options = {
    target: null,
    envFile: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    jsonOut: null,
    keep: false,
    workerPrecheck: true,
    fixture: 'safe',
    dbCa: process.env.DATABASE_CA_CERT_PATH ?? null,
    expectSha: null,
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

function redisConnection() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  const url = new URL(redisUrl)
  const connection = {
    host: bareHostname(redisUrl),
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null,
  }
  if (url.password) connection.password = decodeURIComponent(url.password)
  if (url.username && url.username !== 'default') {
    connection.username = decodeURIComponent(url.username)
  }
  if (url.protocol === 'rediss:' || process.env.REDIS_TLS === 'true') connection.tls = {}
  return connection
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
    }
  } catch (error) {
    return {
      known: false,
      count: null,
      note: `CLIENT LIST unavailable: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function cleanup({ db, storage, queue, ids, objectPath, jobId }) {
  const problems = []
  const attempt = async (label, work) => {
    try {
      await work()
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (queue && jobId) {
    await attempt('job', async () => {
      const job = await queue.getJob(jobId)
      if (job) await job.remove()
    })
  }
  if (db) {
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
  if (storage && objectPath) {
    await attempt('storage object', async () => {
      const { error } = await storage.from(BUCKET).remove([objectPath])
      if (error) throw new Error(error.message)
    })
  }
  return problems
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
 * The PostgreSQL client for a target. A hosted client verifies the server
 * certificate against the Supabase CA and the host name (verify-full), and the
 * effective configuration pg resolved is checked before anything connects.
 */
export function createDatabaseClient(pg, { target, databaseUrl, ca }) {
  if (target !== 'hosted') return new pg.Client({ connectionString: databaseUrl })
  const client = new pg.Client({
    connectionString: withoutSslParameters(databaseUrl),
    ssl: { ca, rejectUnauthorized: true },
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

async function openClients(options) {
  const { supabaseUrl, serviceRoleKey } = requireStorageCredentials()
  const { default: pg } = await import('pg')
  const { Queue } = await import('bullmq')
  const { createClient } = await import('@supabase/supabase-js')
  return {
    db: createDatabaseClient(pg, {
      target: options.target,
      databaseUrl: process.env.DATABASE_URL,
      ca: options.target === 'hosted' ? fs.readFileSync(options.dbCa, 'utf8') : null,
    }),
    storage: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage,
    queue: new Queue(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    }),
  }
}

async function precheckWorkers(queue, options) {
  const workers = options.workerPrecheck
    ? await countWorkers(queue)
    : { known: false, count: null, note: 'skipped by --no-worker-precheck' }
  if (workers.known && workers.count === 0) {
    throw new CanaryFailure(
      'worker_absent',
      `No worker is connected to the ${QUEUE_NAME} queue on this Redis.`
    )
  }
  if (options.target === 'hosted') {
    // Exactly one consumer, and the one built from the commit under test. A
    // second consumer would take some jobs and its identity would go unproven.
    const expected = workerNameFor(options.expectSha)
    if (
      !workers.known ||
      workers.count !== 1 ||
      !workers.names[0]?.endsWith(`:w:${expected}`)
    ) {
      throw new CanaryFailure(
        'worker_identity',
        `The hosted canary needs exactly one consumer named ${expected}; Redis reported ${workers.known ? JSON.stringify(workers.names) : 'no client list'}.`,
        { expectedWorker: expected }
      )
    }
  }
  return workers
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

/** Polls the post until it leaves pending_review or the bounded wait expires. */
async function awaitTerminalPost(db, postId, deadline) {
  let post = await readPost(db, postId)
  while (!TERMINAL_STATUSES.has(post?.status) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    post = await readPost(db, postId)
  }
  return post
}

/** Names why a post never reached a terminal state, from what the job did. */
function nonTerminalFailure(post, job, jobState, timeoutMs) {
  if (jobState === 'waiting' || jobState === 'prioritized') {
    return new CanaryFailure(
      'worker_absent',
      `The job stayed ${jobState} for ${timeoutMs} ms, so no worker picked it up.`,
      { jobState }
    )
  }
  return new CanaryFailure(
    'timeout',
    `The post was still ${post?.status ?? 'missing'} after ${timeoutMs} ms (job ${jobState}).`,
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

async function driveCanary(context, options) {
  const { db, storage, queue, ids, objectPath, jobId, fixture } = context
  await db.connect()
  const workers = await precheckWorkers(queue, options)
  await uploadFixture(storage, objectPath, fixture)
  context.created = true
  await createCanaryRows(db, ids, fixture, objectPath)

  const enqueuedAt = Date.now()
  await queue.add(
    JOB_NAME,
    { postId: ids.postId, uploadSessionId: ids.uploadSessionId },
    {
      jobId,
      removeOnComplete: { age: JOB_RETENTION_SECONDS },
      removeOnFail: { age: JOB_RETENTION_SECONDS },
    }
  )

  const post = await awaitTerminalPost(db, ids.postId, enqueuedAt + options.timeoutMs)
  const observedTerminalAt = Date.now()
  const job = await queue.getJob(jobId)
  const jobState = job ? await job.getState() : 'missing'
  if (!TERMINAL_STATUSES.has(post?.status)) {
    throw nonTerminalFailure(post, job, jobState, options.timeoutMs)
  }

  const assessed = assessTerminalPost(post)
  const processedBy = job?.processedBy ?? null
  if (options.requireProcessedBy && processedBy !== workerNameFor(options.expectSha)) {
    throw new CanaryFailure(
      'worker_identity',
      `The canary job was processed by ${String(processedBy)}, not ${workerNameFor(options.expectSha)}.`
    )
  }
  const { inputSetHash } = await import('./lib/community-screening-input-set.mjs')
  return {
    ok: true,
    target: options.target,
    inputSetHash: inputSetHash(),
    expectedSha: options.expectSha,
    processedByRequired: options.requireProcessedBy === true,
    processedBy,
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
  if (problems.length > 0) {
    report.ok = false
    report.code = 'cleanup_failed'
    report.message = `Cleanup left canary data behind: ${problems.join('; ')}`
  }
  return report
}

export async function runCanary(options) {
  loadEnvFile(options.envFile)
  assertTargetMatchesDatabase(options.target, process.env.DATABASE_URL)
  options.expectSha ??= gitHeadSha()
  const clients = await openClients(options)
  const context = {
    ...clients,
    ...canaryIdentifiers(),
    fixture: options.fixture === 'max' ? await generateMaxFixture() : readFixture(),
    startedAt: new Date(),
    created: false,
  }

  let report
  try {
    report = await driveCanary(context, options)
    return report
  } finally {
    const problems = options.keep
      ? []
      : await cleanup({
          db: context.db,
          storage: context.storage,
          queue: context.queue,
          ids: context.ids,
          objectPath: context.created ? context.objectPath : null,
          jobId: context.jobId,
        })
    if (problems.length > 0) {
      // Printed whether or not the run produced a report: a failed canary that
      // also left rows or an object behind must say so.
      console.error(`[canary] cleanup problems: ${problems.join('; ')}`)
    }
    if (report) recordCleanup(report, { keep: options.keep, problems })
    await context.queue.close().catch(() => undefined)
    await context.db.end().catch(() => undefined)
  }
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
  } catch (error) {
    const failure =
      error instanceof CanaryFailure
        ? { ok: false, code: error.code, message: error.message, details: error.details }
        : {
            ok: false,
            code: 'error',
            message: error instanceof Error ? error.message : String(error),
          }
    failure.target = options.target
    // The same identity a passing report carries, so the readiness gate judges
    // a failure as failed rather than discarding it as stale.
    failure.expectedSha = options.expectSha ?? null
    const { inputSetHash } = await import('./lib/community-screening-input-set.mjs')
    failure.inputSetHash = inputSetHash()
    failure.finishedAt = new Date().toISOString()
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
