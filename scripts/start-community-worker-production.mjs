/*
 * Production entrypoint for the hosted community worker container.
 *
 * Story 6.2b, Task 1. The container's CMD, run under tini as PID 1. It does three
 * things before the BullMQ consumer exists, and one thing at the end of its life:
 *
 *   1. refuses an unset, unknown, or `fixture` screener selector, so a hosted
 *      worker can never come up screening with something that is not a model,
 *      and, under NODE_ENV=production, a DATABASE_URL to a non-local host that
 *      would not verify the database's certificate;
 *   2. verifies the pinned model artifacts, WASM binaries and policy hash with the
 *      Story 6.2 verifier, and exits nonzero on any mismatch;
 *   3. starts the compiled community bootstrap in this process, which awaits model
 *      readiness before constructing the consumer and logs the readiness line;
 *   4. turns SIGTERM and SIGINT into the bootstrap's graceful shutdown, which
 *      closes the consumer, the moderation queue, the model process, Redis and
 *      Prisma, with a hard deadline so a wedged close cannot outlive the host's
 *      grace period silently.
 *
 * In-process rather than a child: one Node runtime is roughly 40 MiB the 512 MiB
 * sandbox envelope does not have to spend twice.
 *
 * `--self-test` loads the real model from the installed tree, screens a generated
 * image, validates the text lists, prints the identity, then drills the container
 * CMD: it runs this launcher as a child exactly as the CMD does, waits for the
 * started line, sends SIGTERM and requires one shutdown and exit 0. The Docker
 * build runs it against the pruned dependency tree, so a dependency the prune
 * trace missed, or a start or shutdown call the compiled bootstrap no longer
 * accepts, fails the build rather than the first job.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const apiDist = path.join(projectRoot, 'apps/api/dist/src')

const SELECTOR_ENV = 'COMMUNITY_NSFW_SCREENER'
const STARTABLE_SELECTORS = new Set(['tensorflow', 'unavailable'])
/**
 * Above the bootstrap's own 20-second shutdown deadline and below Northflank's
 * default 30-second grace period between SIGTERM and SIGKILL
 * (`gracePeriodSeconds`; northflank.com/docs/v1/application/scale/scale-instances,
 * read 2026-10-17), so the log says which one gave up. A job still screening
 * when it expires is redelivered by BullMQ's stalled check (community.bootstrap.ts).
 */
export const SHUTDOWN_DEADLINE_MS = 25_000
/** Northflank's default `gracePeriodSeconds`, in milliseconds. */
export const HOST_GRACE_PERIOD_MS = 30_000

function log(event, fields = {}) {
  // One JSON line, the same shape pino emits, so a host's log search treats the
  // launcher's lines and the worker's lines alike.
  console.log(
    JSON.stringify({
      level: 30,
      time: new Date().toISOString(),
      feature: 'community-worker-launcher',
      event,
      ...fields,
    })
  )
}

function fail(event, message, fields = {}) {
  console.error(
    JSON.stringify({
      level: 50,
      time: new Date().toISOString(),
      feature: 'community-worker-launcher',
      event,
      msg: message,
      ...fields,
    })
  )
  process.exit(1)
}

export function resolveStartableSelector(env = process.env) {
  const selector = (env[SELECTOR_ENV] ?? '').trim()
  if (!selector) {
    return {
      ok: false,
      reason: `${SELECTOR_ENV} is unset. A hosted worker must name its screener; set it to tensorflow.`,
    }
  }
  if (selector === 'fixture') {
    return {
      ok: false,
      reason: `${SELECTOR_ENV}=fixture clears every image and proves nothing. It is never valid on a hosted worker.`,
    }
  }
  if (!STARTABLE_SELECTORS.has(selector)) {
    return {
      ok: false,
      reason: `${SELECTOR_ENV}=${selector} is not a supported selector.`,
    }
  }
  return { ok: true, selector }
}

/**
 * The database hosts a local container reaches. A production-mode container run
 * against the laptop's own PostgreSQL (the local canary, the restart drill and
 * the memory measurement) has no TLS to verify.
 */
const LOCAL_DATABASE_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  'host.docker.internal',
])
/** The Supabase Root 2021 CA the image carries (apps/api/Dockerfile.community-worker). */
export const IMAGE_DATABASE_CA = '/app/apps/api/certs/supabase-root-2021-ca.pem'

/**
 * Why a production worker must not connect with this DATABASE_URL, or null when
 * it may (Story 6.2b final review, RF3). Prisma's `sslmode=require` alone
 * encrypts without checking who answers; `sslaccept=strict` with `sslcert`
 * naming the Supabase CA verifies the chain and the host name. Prisma resolves a
 * relative `sslcert` against the generated client's directory, so the path must
 * be absolute, and it must name a file that exists, or every connection fails.
 */
export function databaseTlsRefusal(env = process.env, fileExists = fs.existsSync) {
  if (env.NODE_ENV !== 'production') return null
  const raw = env.DATABASE_URL?.trim()
  if (!raw) return 'DATABASE_URL is unset.'
  let url
  try {
    url = new URL(raw)
  } catch {
    return 'DATABASE_URL is not a valid URL.'
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (LOCAL_DATABASE_HOSTS.has(host)) return null
  const fix = `use sslmode=require&sslcert=${IMAGE_DATABASE_CA}&sslaccept=strict`
  const param = (name) => url.searchParams.get(name)
  if (param('sslmode') !== 'require') {
    return `DATABASE_URL has sslmode=${String(param('sslmode'))}; ${fix}.`
  }
  if (param('sslaccept') !== 'strict') {
    return `DATABASE_URL does not set sslaccept=strict, so the database certificate would not be verified; ${fix}.`
  }
  const sslcert = param('sslcert')
  if (!sslcert || !path.isAbsolute(sslcert)) {
    return `DATABASE_URL needs an absolute sslcert naming the Supabase CA; ${fix}.`
  }
  if (!fileExists(sslcert)) {
    return `DATABASE_URL names sslcert=${sslcert}, which does not exist in this container; ${fix}.`
  }
  return null
}

function verifyModelArtifacts() {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'scripts/verify-community-screening-model.mjs')],
    { stdio: 'inherit', env: process.env }
  )
  if (result.status !== 0) {
    fail(
      'community_worker_model_verification_failed',
      'Model artifact verification failed; the consumer will not start.',
      { exitCode: result.status }
    )
  }
}

async function importCompiled(relativePath) {
  return import(pathToFileURL(path.join(apiDist, relativePath)).href)
}

async function loadBootstrap() {
  const bootstrap = await importCompiled('workers/community.bootstrap.js')
  const startCommunityWorkers =
    bootstrap.startCommunityWorkers ?? bootstrap.default?.startCommunityWorkers
  const performShutdown = bootstrap.performShutdown ?? bootstrap.default?.performShutdown
  const createCommunityWorkerProcessState =
    bootstrap.createCommunityWorkerProcessState ??
    bootstrap.default?.createCommunityWorkerProcessState
  if (
    typeof startCommunityWorkers !== 'function' ||
    typeof performShutdown !== 'function' ||
    typeof createCommunityWorkerProcessState !== 'function'
  ) {
    fail(
      'community_worker_bootstrap_invalid',
      'The compiled community bootstrap does not export startCommunityWorkers, performShutdown and createCommunityWorkerProcessState.'
    )
  }
  return { startCommunityWorkers, performShutdown, createCommunityWorkerProcessState }
}

async function selfTest() {
  const startedAt = Date.now()
  // Loads the whole consumer graph (Nest decorators, Prisma, BullMQ, storage)
  // without starting it: the bootstrap only starts when it is the main module.
  // The model check below never touches that graph, so without this a package
  // the prune trace missed there would surface only at container start.
  await loadBootstrap()
  const { default: sharp } = await import('sharp')
  const policyModule = await importCompiled(
    'modules/community/community-screening-policy.js'
  )
  const textModule = await importCompiled('modules/community/community-text-screener.js')
  const screenerModule = await importCompiled(
    'modules/community/tensorflow-nsfw-image-screener.js'
  )

  const loaded = policyModule.loadCommunityScreeningPolicy()
  const textScreener = new textModule.CommunityTextScreener({
    policy: loaded.policy.text,
    policyVersion: loaded.identity.textEngineVersion,
  })
  const text = textScreener.screen({
    text: 'A plum satin wrap dress with a cropped linen jacket.',
    field: 'caption',
    locale: 'en-US',
  })

  const screener = new screenerModule.TensorflowNsfwImageScreener()
  try {
    const readiness = await screener.ensureReady()
    const image = await sharp({
      create: { width: 512, height: 640, channels: 3, background: '#beb4aa' },
    })
      .jpeg({ quality: 90 })
      .toBuffer()
    const result = await screener.screen(image)
    const engineVersion = screener.engineVersion
    const problems = []
    // A flat neutral swatch must publish. Anything else means the model, the
    // policy or the preprocessing in this image disagrees with the evidence.
    if (result.disposition !== 'pass') {
      problems.push(
        `the safe self-test image reached ${String(result.disposition)}, not pass`
      )
    }
    if (/fixture|unresolved/.test(engineVersion)) {
      problems.push(`engine identity ${engineVersion} is not a real-model identity`)
    }
    if (text.disposition !== 'pass') {
      problems.push(
        `the text screener refused ordinary copy (${text.reasons.join(', ')})`
      )
    }
    const report = {
      engineVersion,
      textEngineVersion: text.policyVersion,
      policyVersion: readiness?.policyVersion ?? null,
      modelHash: readiness?.modelHash ?? null,
      backend: readiness?.backend ?? null,
      disposition: result.disposition,
      inferenceMs: result.inferenceMs,
      rssMib: Number((process.memoryUsage().rss / 1048576).toFixed(1)),
      durationMs: Date.now() - startedAt,
    }
    if (problems.length > 0) {
      fail('community_worker_self_test_failed', problems.join('; '), report)
    }
    log('community_worker_self_test_passed', report)
  } finally {
    await screener.close()
  }
}

/**
 * The drill's child reaches no service: Redis and Postgres point at a refused
 * loopback port, and the storage, analytics and incident settings are local
 * placeholders. The worker starts degraded, as it does when its services are
 * down, which is all the drill needs: the same start and shutdown calls the CMD
 * makes, with the same compiled bootstrap.
 */
export const DRILL_READY_DEADLINE_MS = 120_000
export const DRILL_ENV = {
  REDIS_URL: 'redis://127.0.0.1:1',
  DATABASE_URL: 'postgresql://drill:drill@127.0.0.1:1/drill',
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'community-worker-drill-placeholder',
  ANALYTICS_ID_SECRET: 'community-worker-drill-placeholder-0123456789',
  COMMUNITY_DISPATCH_ENABLED: 'false',
  // The started and shutdown lines are info lines; production defaults quieter.
  LOG_LEVEL: 'info',
}
const STARTED_LINE = 'Dedicated community worker started'
const SHUTDOWN_LINE = 'Shutting down community workers'

export function drillStartAndShutdown(env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...env, ...DRILL_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let signaled = false
    const deadline = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(`no clean start and shutdown within ${DRILL_READY_DEADLINE_MS} ms`)
      )
    }, DRILL_READY_DEADLINE_MS + SHUTDOWN_DEADLINE_MS)
    const read = (chunk) => {
      output += chunk
      if (!signaled && output.includes(STARTED_LINE)) {
        signaled = true
        child.kill('SIGTERM')
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('exit', (code, signal) => {
      clearTimeout(deadline)
      const shutdowns = output.split(SHUTDOWN_LINE).length - 1
      const report = { started: signaled, exitCode: code, signal, shutdowns }
      if (signaled && code === 0 && shutdowns === 1) resolve(report)
      else reject(Object.assign(new Error(output.slice(-2000)), { report }))
    })
  })
}

async function start(selector) {
  const { startCommunityWorkers, performShutdown, createCommunityWorkerProcessState } =
    await loadBootstrap()
  // This process's one worker state: start fills it, shutdown closes what it holds.
  const state = createCommunityWorkerProcessState()

  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    log('community_worker_shutdown_requested', { signal })
    const deadline = setTimeout(() => {
      fail(
        'community_worker_shutdown_deadline_exceeded',
        `Graceful shutdown did not finish within ${SHUTDOWN_DEADLINE_MS} ms; exiting.`,
        { signal }
      )
    }, SHUTDOWN_DEADLINE_MS)
    deadline.unref()
    // performShutdown closes everything and calls process.exit itself.
    void performShutdown(state)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  log('community_worker_starting', { selector, node: process.version })
  await startCommunityWorkers(state)
}

async function main() {
  const selection = resolveStartableSelector()
  if (!selection.ok) {
    fail('community_worker_selector_refused', selection.reason)
  }
  if (selection.selector === 'tensorflow') {
    verifyModelArtifacts()
  }
  if (process.argv.includes('--self-test')) {
    if (selection.selector !== 'tensorflow') {
      fail(
        'community_worker_self_test_refused',
        'The self-test needs the tensorflow selector.'
      )
    }
    await selfTest()
    try {
      log('community_worker_drill_passed', await drillStartAndShutdown())
    } catch (error) {
      fail(
        'community_worker_drill_failed',
        'The launcher did not start and shut down cleanly as the CMD runs it.',
        { ...(error.report ?? {}), output: error.message }
      )
    }
    process.exit(0)
  }
  const tlsRefusal = databaseTlsRefusal()
  if (tlsRefusal) {
    fail('community_worker_database_tls_refused', tlsRefusal)
  }
  await start(selection.selector)
}

const invokedDirectly =
  process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    fail(
      'community_worker_launcher_error',
      error instanceof Error ? error.message : String(error)
    )
  })
}
