/*
 * Measures the community screening runtime from compiled output, the way the
 * deployed worker runs it.
 *
 * Story 6.2b, AC 6. Records cold startup, the warm per-inference latency
 * distribution and the process peak resident set for one supervised model
 * instance, and writes them as JSON for the readiness evidence. It ships inside
 * the worker image, so the same command measures a laptop checkout, the local
 * container under the sandbox's resource limits, and the hosted container:
 *
 *   docker run --rm --memory=512m --cpus=0.2 -e COMMUNITY_NSFW_SCREENER=tensorflow \
 *     couture-cast-community-worker node scripts/measure-community-worker-runtime.mjs
 *
 * Every sample runs the full supervised path (message to the inference thread,
 * decode, resize, classify, validate, policy evaluation), on a generated image so
 * no fixture has to be present. Peak RSS is process-wide because the inference
 * runtime is a worker thread in the same process, which is the right number for
 * a container memory limit.
 *
 * Usage: node scripts/measure-community-worker-runtime.mjs [--warm 1000] [--warmup 50] [--profile <label>]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const screenerModulePath = path.join(
  projectRoot,
  'apps/api/dist/src/modules/community/tensorflow-nsfw-image-screener.js'
)

function parseArgs(argv) {
  const options = { warm: 1000, warmup: 50, profile: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--warm') options.warm = Number(argv[++index])
    else if (arg === '--warmup') options.warmup = Number(argv[++index])
    else if (arg === '--profile') options.profile = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  for (const key of ['warm', 'warmup']) {
    if (!Number.isInteger(options[key]) || options[key] < 0) {
      throw new Error(`--${key} must be a non-negative integer`)
    }
  }
  return options
}

export function percentile(sorted, fraction) {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

const round = (value, digits = 2) =>
  value === null ? null : Number(value.toFixed(digits))

/** Peak RSS in MiB. `maxRSS` is reported in kibibytes on Linux and macOS alike. */
function peakResidentMib() {
  return process.resourceUsage().maxRSS / 1024
}

/** The CPU quota a cgroup v2 container was given, when one applies. */
async function containerCpuQuota() {
  try {
    const { readFile } = await import('node:fs/promises')
    const [quota, period] = (await readFile('/sys/fs/cgroup/cpu.max', 'utf8'))
      .trim()
      .split(' ')
    return quota === 'max' ? null : Number(quota) / Number(period)
  } catch {
    return null
  }
}

async function containerMemoryLimitMib() {
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim()
    return raw === 'max' ? null : Number(raw) / 1048576
  } catch {
    return null
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if ((process.env.COMMUNITY_NSFW_SCREENER ?? '').trim() !== 'tensorflow') {
    throw new Error(
      'Set COMMUNITY_NSFW_SCREENER=tensorflow; this measures the real model only.'
    )
  }
  const { default: sharp } = await import('sharp')
  const { TensorflowNsfwImageScreener } = await import(
    pathToFileURL(screenerModulePath).href
  )

  const baselineResidentMib = process.memoryUsage().rss / 1048576
  const image = await sharp({
    create: { width: 512, height: 640, channels: 3, background: '#beb4aa' },
  })
    .jpeg({ quality: 90 })
    .toBuffer()

  const screener = new TensorflowNsfwImageScreener()
  const coldStartedAt = performance.now()
  const readiness = await screener.ensureReady()
  const coldStartupMs = performance.now() - coldStartedAt

  try {
    for (let index = 0; index < options.warmup; index += 1) {
      await screener.screen(image)
    }
    const supervised = []
    const inThread = []
    let dispositions = {}
    for (let index = 0; index < options.warm; index += 1) {
      const startedAt = performance.now()
      const result = await screener.screen(image)
      supervised.push(performance.now() - startedAt)
      inThread.push(result.inferenceMs)
      dispositions = {
        ...dispositions,
        [result.disposition]: (dispositions[result.disposition] ?? 0) + 1,
      }
    }
    supervised.sort((a, b) => a - b)
    inThread.sort((a, b) => a - b)

    const report = {
      measuredAt: new Date().toISOString(),
      profile: options.profile,
      // The image's own identity (Dockerfile build arguments), so the readiness
      // generator can tell a measurement of a stale image from a current one.
      commitSha: process.env.COMMUNITY_WORKER_COMMIT_SHA ?? null,
      inputSetHash: process.env.COMMUNITY_WORKER_INPUT_SET_HASH ?? null,
      executedFrom: 'compiled dist under plain node',
      engineVersion: screener.engineVersion,
      modelHash: readiness.modelHash,
      policyVersion: readiness.policyVersion,
      backend: readiness.backend,
      coldStartupMs: round(coldStartupMs, 1),
      readinessStartupDurationMs: readiness.startupDurationMs,
      warmupSamples: options.warmup,
      warmSamples: options.warm,
      warmSupervisedMs: {
        p50: round(percentile(supervised, 0.5)),
        p95: round(percentile(supervised, 0.95)),
        p99: round(percentile(supervised, 0.99)),
        max: round(supervised.at(-1) ?? null),
      },
      warmInThreadMs: {
        p50: round(percentile(inThread, 0.5)),
        p95: round(percentile(inThread, 0.95)),
        p99: round(percentile(inThread, 0.99)),
        max: round(inThread.at(-1) ?? null),
      },
      peakResidentMib: round(peakResidentMib(), 1),
      baselineResidentMibBeforeModelLoad: round(baselineResidentMib, 1),
      dispositions,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model ?? null,
        cpuCount: os.cpus().length,
        containerCpuQuota: await containerCpuQuota(),
        containerMemoryLimitMib: await containerMemoryLimitMib(),
        image: '512x640 JPEG, quality 90, flat #beb4aa, generated in process',
        replicas: 1,
        concurrency: 1,
      },
    }
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await screener.close()
  }
}

const invokedDirectly =
  process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[measure] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
