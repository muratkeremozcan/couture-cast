import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const startWeb = process.argv.includes('--with-web')
const apiBaseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:4000'
const webBaseUrl = process.env.WEB_E2E_BASE_URL || 'http://127.0.0.1:3005'
const webUrl = new URL(webBaseUrl)

const env = {
  ...process.env,
  NODE_ENV: 'test',
  TEST_ENV: 'local',
  GARMENT_TAGGING_ENGINE: 'fixture',
  PORT: process.env.PORT || '4000',
  API_BASE_URL: apiBaseUrl,
  HTTP_CORS_ORIGIN: process.env.HTTP_CORS_ORIGIN || webBaseUrl,
  PUBLIC_API_URL: process.env.PUBLIC_API_URL || apiBaseUrl,
}

const processes = []
let shuttingDown = false

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    child.once('exit', resolve)
    child.once('error', resolve)
  })
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const proc of processes) {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM')
    }
  }
  await Promise.race([
    Promise.all(processes.map(waitForExit)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  const remaining = processes.filter(
    (proc) => proc.exitCode === null && proc.signalCode === null
  )
  for (const proc of remaining) proc.kill('SIGKILL')
  await Promise.all(remaining.map(waitForExit))
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void shutdown(0))
}

async function runPreparation(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${exitCode}`)
  }
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for ${url}`, { cause: lastError })
}

function startManagedProcess(command, args, processEnv = env, cwd = repoRoot, readyText) {
  const child = spawn(command, args, {
    cwd,
    env: processEnv,
    stdio: readyText ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  })
  let resolveReady
  let rejectReady
  let readinessObserved = !readyText
  let readinessOutput = ''
  let readinessTimer
  const ready = readyText
    ? new Promise((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
        readinessTimer = setTimeout(
          () =>
            reject(new Error(`Timed out waiting for process readiness: ${readyText}`)),
          60_000
        )
      })
    : Promise.resolve()
  const forwardOutput = (stream, destination) => {
    stream?.on('data', (chunk) => {
      destination.write(chunk)
      readinessOutput = `${readinessOutput}${chunk.toString()}`.slice(-4096)
      if (readyText && readinessOutput.includes(readyText)) {
        readinessObserved = true
        clearTimeout(readinessTimer)
        resolveReady?.()
      }
    })
  }
  forwardOutput(child.stdout, process.stdout)
  forwardOutput(child.stderr, process.stderr)
  child.once('error', (error) => {
    clearTimeout(readinessTimer)
    rejectReady?.(error)
    console.error(`[start-api-e2e-with-workers] Failed to spawn ${command}:`, error)
    void shutdown(1)
  })
  child.once('exit', (code) => {
    if (readyText && !readinessObserved) {
      clearTimeout(readinessTimer)
      rejectReady?.(new Error(`${command} exited before readiness with code ${code}`))
    }
  })
  processes.push(child)
  return { child, ready }
}

async function isUrlHealthy(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function main() {
  console.log('[start-api-e2e-with-workers] Preparing database and application builds...')
  const reuseExistingWeb =
    startWeb &&
    process.env.REUSE_EXISTING_WEB_SERVER === 'true' &&
    (await isUrlHealthy(webBaseUrl))
  await runPreparation('npm', ['run', 'db:generate'])
  await runPreparation('node', ['scripts/prisma-migrate-deploy.mjs'])
  if (startWeb) {
    if (process.env.PLAYWRIGHT_SHARED_DEPS_PREPARED !== 'true') {
      await runPreparation('npm', ['run', 'prepare:playwright'])
    }
    await runPreparation('npm', ['run', 'build:e2e', '--workspace', 'api'])
    if (!reuseExistingWeb) {
      await runPreparation('npm', ['run', 'build:e2e', '--workspace', 'web'])
    }
  } else {
    await runPreparation('npm', ['run', 'build', '--workspace', 'api'])
  }

  console.log(
    '[start-api-e2e-with-workers] Starting API and Wardrobe Worker in E2E fixture mode...'
  )

  const { child: apiProcess } = startManagedProcess('node', ['apps/api/dist/src/main.js'])

  const { child: workerProcess, ready: workerReady } = startManagedProcess(
    'node',
    ['apps/api/dist/src/workers/wardrobe.bootstrap.js'],
    env,
    repoRoot,
    'Dedicated wardrobe worker started'
  )

  apiProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[start-api-e2e-with-workers] API process exited with code ${code}`)
      void shutdown(code ?? 1)
    }
  })

  workerProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(
        `[start-api-e2e-with-workers] Wardrobe worker process exited with code ${code}`
      )
      void shutdown(code ?? 1)
    }
  })

  if (startWeb) {
    await Promise.all([
      waitForUrl(new URL('/api/health', apiBaseUrl).toString(), 30_000),
      workerReady,
    ])
    if (reuseExistingWeb) {
      console.log(
        `[start-api-e2e-with-workers] Reusing existing Web server at ${webBaseUrl}`
      )
      return
    }
    const { child: webProcess } = startManagedProcess(
      'node',
      [
        path.join(repoRoot, 'node_modules/next/dist/bin/next'),
        'start',
        '--hostname',
        webUrl.hostname,
        '--port',
        webUrl.port || '3005',
      ],
      {
        ...env,
        API_BASE_URL: apiBaseUrl,
        POSTHOG_API_KEY: process.env.POSTHOG_API_KEY || '',
      },
      path.join(repoRoot, 'apps/web')
    )

    webProcess.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`[start-api-e2e-with-workers] Web process exited with code ${code}`)
        void shutdown(code ?? 1)
      }
    })
  }
}

void main().catch((error) => {
  console.error('[start-api-e2e-with-workers] Startup failed:', error)
  void shutdown(1)
})
