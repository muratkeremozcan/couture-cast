/*
 * Production entrypoint for the hosted wardrobe worker container (the second free Northflank
 * service). The container's CMD, run under tini as PID 1. Before the BullMQ consumers exist it:
 *
 *   1. refuses a configuration the hosted service may not run (`hostedWardrobeConfigProblems`,
 *      the compiled `workers/hosted-wardrobe-config.js`, which the bootstrap asserts again): a
 *      `TEST_ENV` (it opens the fixture engines even under NODE_ENV=production), any fixture
 *      selector, a `GARMENT_TAGGING_ENGINE` other than `manual` (this image carries no model),
 *      missing database, Redis, Supabase or engine configuration, and a missing
 *      `WARDROBE_MAINTENANCE_ENABLED=true` (the retention purge, the job handoff and the
 *      deletion drain run only here, and a forgotten variable would stop them without a sign);
 *   2. refuses, under NODE_ENV=production, a DATABASE_URL to a non-local host that would not
 *      verify the database's certificate (the community worker's own check, imported from
 *      `start-community-worker-production.mjs` so the two cannot drift);
 *   3. starts the compiled wardrobe bootstrap in this process (one Node runtime, not two), in
 *      hosted mode: it checks the database, Redis and storage before it consumes and logs
 *      `wardrobe_worker_ready`, apart from the `started` line;
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

async function importCompiled(relativePath) {
  return import(pathToFileURL(path.join(apiDist, relativePath)).href)
}

let loadedHostedConfig = null

/** The compiled `workers/hosted-wardrobe-config.js`: the one definition the bootstrap asserts too. */
export async function loadHostedConfig() {
  loadedHostedConfig ??= await importCompiled('workers/hosted-wardrobe-config.js')
  return loadedHostedConfig
}

/**
 * Why this environment may not start the hosted worker, or null when it may. `config` is the
 * hosted configuration module (the compiled one by default once loaded); the drill flag exempts
 * maintenance and the dependency checks only for the isolated drill configuration.
 */
export function startRefusal(
  env = process.env,
  { drillChild = false, config = loadedHostedConfig } = {}
) {
  if (!config) throw new Error('The hosted wardrobe configuration is not loaded.')
  const problems = config.hostedWardrobeConfigProblems(env, { drillChild })
  return problems.length > 0 ? problems.join(' ') : null
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
 * The drill's child reaches no service: Redis, Postgres and Supabase point at a refused loopback
 * address (`ISOLATED_DRILL_ENV`, defined beside the configuration check, which exempts only that
 * exact configuration from the maintenance flag and the dependency checks). The worker starts
 * degraded, as it does when its services are down, which is all the drill needs: the same start
 * and shutdown calls the CMD makes, with the same compiled bootstrap.
 */
export const DRILL_READY_DEADLINE_MS = 120_000
const MAINTENANCE_ENV = 'WARDROBE_MAINTENANCE_ENABLED'
const STARTED_LINE = 'Dedicated wardrobe worker started'
const SHUTDOWN_LINE = 'Shutting down dedicated wardrobe worker'

export function drillStartAndShutdown(env = process.env, config = loadedHostedConfig) {
  if (!config) throw new Error('The hosted wardrobe configuration is not loaded.')
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), DRILL_CHILD_ARGUMENT],
      {
        env: { ...env, ...config.ISOLATED_DRILL_ENV, [ENGINE_ENV]: 'manual' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
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

async function start(drillChild) {
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
  // Hosted mode: the bootstrap asserts the same configuration and checks its dependencies.
  await startWardrobeWorker({ hosted: true, drillChild })
}

async function main() {
  const drillChild = process.argv.includes(DRILL_CHILD_ARGUMENT)
  const config = await loadHostedConfig()

  if (process.argv.includes('--self-test')) {
    // The build has no database, Redis or Supabase to start against; it proves the compiled
    // configuration check refuses a test profile with fixtures, then the consumer graph, then
    // the launcher's own start and shutdown through the drill.
    const bypass = config.hostedWardrobeConfigProblems({
      NODE_ENV: 'production',
      TEST_ENV: 'local',
      SILHOUETTE_MODERATION_ENGINE: 'fixture',
      PALETTE_ANALYSIS_ENGINE: 'fixture',
      GARMENT_TAGGING_ENGINE: 'fixture',
    })
    if (!bypass.some((problem) => problem.startsWith('TEST_ENV=local is refused'))) {
      fail(
        'wardrobe_worker_self_test_failed',
        'The compiled hosted configuration check did not refuse TEST_ENV=local.'
      )
    }
    await selfTest()
    try {
      log(
        'wardrobe_worker_drill_passed',
        await drillStartAndShutdown(process.env, config)
      )
    } catch (error) {
      fail(
        'wardrobe_worker_drill_failed',
        'The launcher did not start and shut down cleanly as the CMD runs it.',
        { ...(error.report ?? {}), output: error.message }
      )
    }
    process.exit(0)
  }

  const refusal = startRefusal(process.env, { drillChild, config })
  if (refusal) fail('wardrobe_worker_start_refused', refusal)
  const tlsRefusal = databaseTlsRefusal()
  if (tlsRefusal) fail('wardrobe_worker_database_tls_refused', tlsRefusal)
  await start(drillChild)
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
