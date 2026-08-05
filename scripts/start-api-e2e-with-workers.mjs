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
  PUBLIC_API_URL:
    process.env.PUBLIC_API_URL || (startWeb ? webBaseUrl : 'http://127.0.0.1:4000'),
}

const processes = []
let shuttingDown = false

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolve) => child.once('exit', resolve))
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const proc of processes) {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM')
    }
  }
  await Promise.all(processes.map(waitForExit))
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

function startManagedProcess(command, args, processEnv = env, cwd = repoRoot) {
  const child = spawn(command, args, {
    cwd,
    env: processEnv,
    stdio: 'inherit',
  })
  processes.push(child)
  return child
}

async function main() {
  console.log('[start-api-e2e-with-workers] Preparing database and application builds...')
  await runPreparation('npm', ['run', 'db:generate'])
  await runPreparation('node', ['scripts/prisma-migrate-deploy.mjs'])
  if (startWeb) {
    if (process.env.PLAYWRIGHT_SHARED_DEPS_PREPARED !== 'true') {
      await runPreparation('npm', ['run', 'prepare:playwright'])
    }
    await runPreparation('npm', ['run', 'build:e2e', '--workspace', 'api'])
    await runPreparation('npm', ['run', 'build:e2e', '--workspace', 'web'])
  } else {
    await runPreparation('npm', ['run', 'build', '--workspace', 'api'])
  }

  console.log(
    '[start-api-e2e-with-workers] Starting API and Wardrobe Worker in E2E fixture mode...'
  )

  const apiProcess = startManagedProcess('node', ['apps/api/dist/src/main.js'])

  const workerProcess = startManagedProcess('node', [
    'apps/api/dist/src/workers/wardrobe.bootstrap.js',
  ])

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
    await waitForUrl(new URL('/api/health', apiBaseUrl).toString(), 30_000)
    const webProcess = startManagedProcess(
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
