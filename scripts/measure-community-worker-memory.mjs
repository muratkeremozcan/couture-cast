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
 * Usage: node scripts/measure-community-worker-memory.mjs [--container cc-community-worker]
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputSetHash } from './lib/community-screening-input-set.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const MIB = 1024 * 1024

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

  const canaryOutput = execFileSync(
    process.execPath,
    [
      path.join(projectRoot, 'scripts/community-screening-canary.mjs'),
      '--target',
      'local',
      '--env-file',
      '.env.local',
      '--fixture',
      'max',
    ],
    { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  )
  const canary = JSON.parse(canaryOutput.slice(0, canaryOutput.lastIndexOf('}') + 1))
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
