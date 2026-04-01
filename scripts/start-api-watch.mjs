import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

// We intentionally run the compiled Nest app here instead of `tsx watch src/main.ts`.
// The source-run path diverged from the built runtime used by local E2E and OTEL smoke tests,
// which made `start:api` unreliable exactly when we needed local observability to behave like
// the real app. This script keeps the dev loop on the compiled output and restarts it after
// successful rebuilds, so local dev, local E2E, and OTEL verification all exercise the same
// bootstrap path.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiBundlePath = path.join(repoRoot, 'apps/api/dist/src/main.js')
const inspectEnabled = process.argv.includes('--inspect')
const watchReadyPatterns = [
  'Found 0 errors. Watching for file changes.',
  'Found 0 error. Watching for file changes.',
]
const watchTargets = [
  {
    name: 'shared-config',
    command: ['npm', ['run', 'build:watch', '--workspace', '@couture/config']],
  },
  {
    name: 'api-client',
    command: ['npm', ['run', 'build:watch', '--workspace', '@couture/api-client']],
  },
  {
    name: 'api',
    command: ['npm', ['run', 'build:watch', '--workspace', 'api']],
  },
]

let runtimeStarted = false
let shuttingDown = false
let restartPending = false
let runtimeProcess = null
let syncTimer = null

const buildReady = new Map(watchTargets.map(({ name }) => [name, false]))
const watchProcesses = []

function terminate(child) {
  if (!child || child.killed) return
  child.kill('SIGINT')
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  clearSyncTimer()
  terminate(runtimeProcess)
  for (const child of watchProcesses) {
    terminate(child)
  }
  process.exit(exitCode)
}

function clearSyncTimer() {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
}

function startRuntime() {
  if (runtimeStarted || !existsSync(apiBundlePath)) {
    return
  }

  runtimeStarted = true
  runtimeProcess = spawn(
    'node',
    [...(inspectEnabled ? ['--inspect'] : []), 'apps/api/dist/src/main.js'],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    }
  )

  runtimeProcess.on('exit', (code, signal) => {
    runtimeStarted = false
    runtimeProcess = null

    if (restartPending && !shuttingDown) {
      restartPending = false
      startRuntime()
      return
    }

    if (shuttingDown) {
      process.exit(code ?? (signal ? 1 : 0))
    }
  })
}

function restartRuntime() {
  if (!existsSync(apiBundlePath)) {
    return
  }

  if (!runtimeStarted) {
    startRuntime()
    return
  }

  restartPending = true
  terminate(runtimeProcess)
}

function allBuildsReady() {
  return [...buildReady.values()].every(Boolean)
}

function scheduleRuntimeSync() {
  if (!allBuildsReady()) {
    return
  }

  if (!runtimeStarted) {
    startRuntime()
    return
  }

  clearSyncTimer()
  syncTimer = setTimeout(() => {
    syncTimer = null
    if (!shuttingDown) {
      restartRuntime()
    }
  }, 150)
}

function handleBuildChunk(targetName, chunk, writer) {
  const text = chunk.toString()
  writer.write(text)

  if (watchReadyPatterns.some((pattern) => text.includes(pattern))) {
    buildReady.set(targetName, true)
    scheduleRuntimeSync()
  }
}

for (const target of watchTargets) {
  const [command, args] = target.command
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  watchProcesses.push(child)

  child.stdout.on('data', (chunk) => handleBuildChunk(target.name, chunk, process.stdout))
  child.stderr.on('data', (chunk) => handleBuildChunk(target.name, chunk, process.stderr))

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? (signal ? 1 : 0))
    }

    clearSyncTimer()
    terminate(runtimeProcess)
    process.exit(code ?? 1)
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0))
}
