/*
 * Production entrypoint for the hosted wardrobe worker container (the second free Northflank
 * service). The container's CMD, run under tini as PID 1. Before the BullMQ consumers exist it:
 *
 *   1. refuses a `GARMENT_TAGGING_ENGINE` other than `manual`, because this image carries no
 *      model and a hosted worker must never come up pretending to suggest tags, and refuses to
 *      start without `WARDROBE_MAINTENANCE_ENABLED=true`, because the retention purge, the job
 *      handoff and the deletion drain run only here and a forgotten variable would stop them
 *      without a sign;
 *   2. refuses, under NODE_ENV=production, a DATABASE_URL to a non-local host that would not
 *      verify the database's certificate (the community worker's own check, imported from
 *      `start-community-worker-production.mjs` so the two cannot drift);
 *   3. starts the compiled wardrobe bootstrap in this process (one Node runtime, not two);
 *   4. turns SIGTERM and SIGINT into the bootstrap's graceful shutdown, with a hard deadline so
 *      a wedged close cannot outlive the host's grace period silently.
 *
 * `--self-test` runs at image build against the pruned tree: it loads the compiled consumer
 * graph, proves the manual engine loads no model runtime, decodes an image with sharp, then
 * drills the CMD: it runs this launcher as a child, waits for the started line, sends SIGTERM and
 * requires one shutdown and exit 0.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { databaseTlsRefusal } from './start-community-worker-production.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const apiDist = path.join(projectRoot, 'apps/api/dist/src')

export const ENGINE_ENV = 'GARMENT_TAGGING_ENGINE'
export const MAINTENANCE_ENV = 'WARDROBE_MAINTENANCE_ENABLED'
/**
 * Above the bootstrap's own 20-second resource shutdown and below Northflank's default 30-second
 * grace period between SIGTERM and SIGKILL, so the log says which one gave up. A job still
 * running when it expires is redelivered by BullMQ's stalled check.
 */
export const SHUTDOWN_DEADLINE_MS = 25_000
/** Argument the drill passes to its child, which has no Redis to schedule against. */
export const DRILL_CHILD_ARGUMENT = '--drill-child'

function log(event, fields = {}) {
  console.log(
    JSON.stringify({
      level: 30,
      time: new Date().toISOString(),
      feature: 'wardrobe-worker-launcher',
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
      feature: 'wardrobe-worker-launcher',
      event,
      msg: message,
      ...fields,
    })
  )
  process.exit(1)
}

/** Why this environment may not start the hosted worker, or null when it may. */
export function startRefusal(env = process.env, { drillChild = false } = {}) {
  const engine = (env[ENGINE_ENV] ?? '').trim()
  if (engine !== 'manual') {
    return `${ENGINE_ENV}=${engine || '(unset)'} is refused. The hosted wardrobe image carries no tagging model; set ${ENGINE_ENV}=manual.`
  }
  if (!drillChild && (env[MAINTENANCE_ENV] ?? '').trim() !== 'true') {
    return `${MAINTENANCE_ENV} is not true. The hosted worker is the only runner of the wardrobe retention purge, the job handoff and the deletion drain; set ${MAINTENANCE_ENV}=true.`
  }
  return null
}

async function importCompiled(relativePath) {
  return import(pathToFileURL(path.join(apiDist, relativePath)).href)
}

async function loadBootstrap() {
  const bootstrap = await importCompiled('workers/wardrobe.bootstrap.js')
  const startWardrobeWorker =
    bootstrap.startWardrobeWorker ?? bootstrap.default?.startWardrobeWorker
  const shutdownWardrobeWorker =
    bootstrap.shutdownWardrobeWorker ?? bootstrap.default?.shutdownWardrobeWorker
  const createTaggingEngine =
    bootstrap.createTaggingEngine ?? bootstrap.default?.createTaggingEngine
  if (
    typeof startWardrobeWorker !== 'function' ||
    typeof shutdownWardrobeWorker !== 'function' ||
    typeof createTaggingEngine !== 'function'
  ) {
    fail(
      'wardrobe_worker_bootstrap_invalid',
      'The compiled wardrobe bootstrap does not export startWardrobeWorker, shutdownWardrobeWorker and createTaggingEngine.'
    )
  }
  return { startWardrobeWorker, shutdownWardrobeWorker, createTaggingEngine }
}

/** Module paths that mean a model runtime was loaded into this process. */
const MODEL_RUNTIME_PATTERN =
  /(onnxruntime|@huggingface[\\/]transformers|fashion-clip-tagging\.engine|fashion-clip-inference)/

export function loadedModelRuntimes(paths) {
  return paths.filter((loaded) => MODEL_RUNTIME_PATTERN.test(loaded))
}

async function selfTest() {
  const startedAt = Date.now()
  const { createTaggingEngine } = await loadBootstrap()
  const problems = []

  const engine = await createTaggingEngine()
  if (engine.constructor.name !== 'ManualGarmentTaggingEngine') {
    problems.push(
      `the tagging engine is ${engine.constructor.name}, not the manual engine`
    )
  }
  const refusal = await engine.inferTags(Buffer.alloc(1)).then(
    () => null,
    (error) => error
  )
  if (refusal?.code !== 'TAGGING_MANUAL_MODE') {
    problems.push('the manual engine did not answer TAGGING_MANUAL_MODE')
  }

  const { default: sharp } = await import('sharp')
  const stats = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#beb4aa' },
  })
    .png()
    .toBuffer()
    .then((png) => sharp(png).stats())
  if (stats.channels.length < 3) problems.push('sharp could not decode a generated image')

  const require = createRequire(import.meta.url)
  const loaded = loadedModelRuntimes(Object.keys(require.cache))
  if (loaded.length > 0) {
    problems.push(`a model runtime was loaded in manual mode: ${loaded.join(', ')}`)
  }

  const report = {
    engine: engine.constructor.name,
    rssMib: Number((process.memoryUsage().rss / 1048576).toFixed(1)),
    durationMs: Date.now() - startedAt,
  }
  if (problems.length > 0) {
    fail('wardrobe_worker_self_test_failed', problems.join('; '), report)
  }
  log('wardrobe_worker_self_test_passed', report)
}

/**
 * The drill's child reaches no service: Redis and Postgres point at a refused loopback port and
 * the storage and analytics settings are local placeholders. The worker starts degraded, as it
 * does when its services are down, which is all the drill needs: the same start and shutdown
 * calls the CMD makes, with the same compiled bootstrap. Maintenance stays off in the child,
 * because registering its schedulers needs a reachable Redis.
 */
export const DRILL_READY_DEADLINE_MS = 120_000
export const DRILL_ENV = {
  REDIS_URL: 'redis://127.0.0.1:1',
  DATABASE_URL: 'postgresql://drill:drill@127.0.0.1:1/drill',
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'wardrobe-worker-drill-placeholder',
  ANALYTICS_ID_SECRET: 'wardrobe-worker-drill-placeholder-0123456789',
  [MAINTENANCE_ENV]: 'false',
  LOG_LEVEL: 'info',
}
const STARTED_LINE = 'Dedicated wardrobe worker started'
const SHUTDOWN_LINE = 'Shutting down dedicated wardrobe worker'

export function drillStartAndShutdown(env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), DRILL_CHILD_ARGUMENT],
      { env: { ...env, ...DRILL_ENV }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
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

async function start() {
  const { startWardrobeWorker, shutdownWardrobeWorker } = await loadBootstrap()

  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    log('wardrobe_worker_shutdown_requested', { signal })
    const deadline = setTimeout(() => {
      fail(
        'wardrobe_worker_shutdown_deadline_exceeded',
        `Graceful shutdown did not finish within ${SHUTDOWN_DEADLINE_MS} ms; exiting.`,
        { signal }
      )
    }, SHUTDOWN_DEADLINE_MS)
    deadline.unref()
    // The bootstrap closes everything and calls process.exit itself.
    void shutdownWardrobeWorker()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  log('wardrobe_worker_starting', {
    engine: process.env[ENGINE_ENV],
    maintenance: process.env[MAINTENANCE_ENV],
    node: process.version,
  })
  await startWardrobeWorker()
}

async function main() {
  const drillChild = process.argv.includes(DRILL_CHILD_ARGUMENT)
  const refusal = startRefusal(process.env, { drillChild })
  if (refusal) fail('wardrobe_worker_start_refused', refusal)

  if (process.argv.includes('--self-test')) {
    await selfTest()
    try {
      log('wardrobe_worker_drill_passed', await drillStartAndShutdown())
    } catch (error) {
      fail(
        'wardrobe_worker_drill_failed',
        'The launcher did not start and shut down cleanly as the CMD runs it.',
        { ...(error.report ?? {}), output: error.message }
      )
    }
    process.exit(0)
  }
  const tlsRefusal = databaseTlsRefusal()
  if (tlsRefusal) fail('wardrobe_worker_database_tls_refused', tlsRefusal)
  await start()
}

const invokedDirectly =
  process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    fail(
      'wardrobe_worker_launcher_error',
      error instanceof Error ? error.message : String(error)
    )
  })
}
