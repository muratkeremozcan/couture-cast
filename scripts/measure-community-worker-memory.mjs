/*
 * Measures the running worker container's peak memory while it screens the
 * largest upload the pipeline accepts.
 *
 * Story 6.2b review (BH15): the memory gate reads the container's own cgroup
 * `memory.peak`, the number the host's out-of-memory killer acts on, not a
 * screener-only measurement. Start the worker container fresh under its memory
 * limit (so the peak covers startup too), then run this: it drives the local
 * canary with a generated 4096x4096 JPEG through the real pipeline and reads
 * `memory.peak` and `memory.max` from inside the container.
 *
 * Story 6.2b peer review (CX4): the peak is evidence only if this container
 * screened the upload. The canary therefore runs against the container's own
 * Redis, PostgreSQL and storage, read from its environment, and requires the job
 * to be processed by the worker named for the container's baked commit. Any other
 * consumer on that Redis taking the job fails the measurement.
 *
 * Story 6.2b second peer review (CX4b): replicas of one image share that name,
 * so the name alone cannot say which replica screened the upload. The canary
 * runs in sole-consumer mode: exactly one consumer on the queue, named for the
 * container's commit, before the job is enqueued and after it completes, on the
 * same Redis connection. With one consumer for the whole run, it is the one
 * whose container this reads. The product records both observations, and the
 * readiness gate rejects a peak without them.
 *
 * Usage: node scripts/measure-community-worker-memory.mjs [--container cc-community-worker]
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerNameFor } from './community-screening-canary.mjs'
import { inputSetHash } from './lib/community-screening-input-set.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const MIB = 1024 * 1024

/** The variables the canary reads to reach the services the container uses. */
export const CONTAINER_SERVICE_VARIABLES = [
  'DATABASE_URL',
  'REDIS_URL',
  'REDIS_TLS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]

/**
 * The container's service endpoints, as this host reaches them. A container on
 * Docker's bridge network reaches the host's published ports through
 * host.docker.internal; from the host, the same ports are on the loopback.
 */
export function containerServiceEnv(containerEnv) {
  const env = {}
  for (const name of CONTAINER_SERVICE_VARIABLES) {
    const value = containerEnv[name]
    if (value === undefined) continue
    env[name] = value.replaceAll('host.docker.internal', '127.0.0.1')
  }
  for (const name of ['DATABASE_URL', 'REDIS_URL']) {
    if (!env[name]) throw new Error(`The container sets no ${name} to measure against.`)
  }
  return env
}

/** The worker name the container gives itself, from its baked commit. */
export function containerWorkerName(containerEnv) {
  const sha = containerEnv.COMMUNITY_WORKER_COMMIT_SHA?.trim()
  if (!sha || sha === 'unset') {
    throw new Error(
      'The container has no baked COMMUNITY_WORKER_COMMIT_SHA, so the job it processes cannot be told apart from another consumer.'
    )
  }
  return { sha, name: workerNameFor(sha) }
}

/**
 * The sole-consumer proof the canary recorded, checked against the container's
 * worker. Throws when the canary did not prove that worker was the only consumer
 * for the whole run.
 */
export function requireSoleConsumerProof(canary, workerName) {
  const proof = canary?.soleConsumer
  if (
    canary?.soleConsumerRequired !== true ||
    proof?.proven !== true ||
    proof.expectedWorker !== workerName
  ) {
    throw new Error(
      `The canary did not prove ${workerName} was the only consumer for the whole run${proof?.problems?.length ? `: ${proof.problems.join('; ')}` : ''}; the container's peak could describe a job another replica ran.`
    )
  }
  return proof
}

function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function readCgroup(container, file) {
  const raw = docker(['exec', container, 'cat', `/sys/fs/cgroup/${file}`]).trim()
  return raw === 'max' ? null : Number(raw)
}

function main() {
  const args = process.argv.slice(2)
  const index = args.indexOf('--container')
  const container = index >= 0 ? args[index + 1] : 'cc-community-worker'
  const env = JSON.parse(
    docker(['inspect', container, '--format', '{{json .Config.Env}}'])
  )
  const imageEnv = Object.fromEntries(env.map((line) => line.split(/=(.*)/s).slice(0, 2)))
  const worker = containerWorkerName(imageEnv)
  const serviceEnv = containerServiceEnv(imageEnv)
  const childEnv = { ...process.env }
  for (const name of CONTAINER_SERVICE_VARIABLES) delete childEnv[name]

  const canaryOutput = execFileSync(
    process.execPath,
    [
      path.join(projectRoot, 'scripts/community-screening-canary.mjs'),
      '--target',
      'local',
      '--fixture',
      'max',
      '--expect-sha',
      worker.sha,
      '--sole-consumer',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...childEnv, ...serviceEnv },
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  )
  const canary = JSON.parse(canaryOutput.slice(0, canaryOutput.lastIndexOf('}') + 1))
  if (canary.processedBy !== worker.name) {
    throw new Error(
      `The upload was processed by ${String(canary.processedBy)}, not ${worker.name}; the container's peak would describe a job it never ran.`
    )
  }
  const soleConsumer = requireSoleConsumerProof(canary, worker.name)
  const peak = readCgroup(container, 'memory.peak')
  const limit = readCgroup(container, 'memory.max')
  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        container,
        commitSha: imageEnv.COMMUNITY_WORKER_COMMIT_SHA ?? null,
        inputSetHash: imageEnv.COMMUNITY_WORKER_INPUT_SET_HASH ?? null,
        hostInputSetHash: inputSetHash(),
        source: 'cgroup v2 memory.peak inside the running worker container',
        memoryPeakMib: peak === null ? null : Number((peak / MIB).toFixed(1)),
        memoryLimitMib: limit === null ? null : Number((limit / MIB).toFixed(1)),
        workerName: worker.name,
        processedBy: canary.processedBy ?? null,
        soleConsumer,
        servicesFrom: 'the container environment (DATABASE_URL, REDIS_URL, SUPABASE_URL)',
        upload: canary.fixture,
        canaryDisposition: canary.disposition ?? null,
        canaryOk: canary.ok === true,
      },
      null,
      2
    )
  )
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(
      `[memory-measure] ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
  }
}
