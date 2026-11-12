import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const installScript = path.join(repoRoot, 'scripts/ci/install-dependencies.sh')
type InstallResult = {
  code: number
  message: string
  signal?: NodeJS.Signals
  holdMs?: number
}
let fixture: string

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'install-download-'))
  fs.mkdirSync(path.join(fixture, 'bin'))
  fs.writeFileSync(
    path.join(fixture, 'bin/npm'),
    `#!/usr/bin/env node
const fs = require('node:fs')
const state = process.env.INSTALL_TEST_STATE
const count = fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) : 0
fs.writeFileSync(state, String(count + 1))
const results = JSON.parse(process.env.INSTALL_TEST_RESULTS)
const result = results[Math.min(count, results.length - 1)]
console.error(result.message)
const finish = () => result.signal ? process.kill(process.pid, result.signal) : process.exit(result.code)
if (result.holdMs) setTimeout(finish, result.holdMs)
else finish()
`,
    { mode: 0o755 }
  )
})

afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }))

function installEnvironment(results: InstallResult[], command = 'npm ci') {
  return {
    ...process.env,
    PATH: `${path.join(fixture, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    INSTALL_COMMAND: command,
    INSTALL_RETRY_DELAY_SECONDS: '0',
    INSTALL_TEST_STATE: path.join(fixture, 'attempts'),
    INSTALL_TEST_RESULTS: JSON.stringify(results),
  }
}

function install(results: InstallResult[], command = 'npm ci') {
  const state = path.join(fixture, 'attempts')
  const result = spawnSync('bash', [installScript], {
    cwd: fixture,
    encoding: 'utf8',
    env: installEnvironment(results, command),
  })
  return { ...result, attempts: Number(fs.readFileSync(state, 'utf8')) }
}

describe('dependency download recovery', () => {
  it('recovers the Prisma download connection reset seen before Playwright started', () => {
    const result = install([
      { code: 1, message: "npm error code: 'ECONNRESET', retriesLeft: 2" },
      { code: 0, message: 'installed' },
    ])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(2)
    expect(result.stdout).toContain('ECONNRESET')
    expect(result.stdout).toContain('::warning::')
  })

  // PR 196: the supabase CLI postinstall downloads from a GitHub release, which answered 504.
  it('recovers the supabase postinstall download that a gateway timeout broke', () => {
    const result = install([
      {
        code: 1,
        message: [
          'npm error path node_modules/supabase',
          'npm error Could not fetch checksum file 504 Gateway Time-out',
          'npm error Error: incorrect header check',
          "npm error   code: 'Z_DATA_ERROR'",
        ].join('\n'),
      },
      { code: 0, message: 'installed' },
    ])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(2)
    expect(result.stdout).toContain('::warning::')
  })

  it.each([
    [
      'a checksum 503 alone',
      'npm error Could not fetch checksum file 503 Service Unavailable',
    ],
    ['a garbled archive alone', "npm error   code: 'Z_DATA_ERROR'"],
  ])('recovers %s', (_name, message) => {
    const result = install([
      { code: 1, message },
      { code: 0, message: 'installed' },
    ])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(2)
  })

  // PR 196 again: the onnxruntime postinstall reports the same burst in its own words.
  it('recovers a package that words the 504 its own way', () => {
    const result = install([
      {
        code: 1,
        message:
          'npm error Error: Failed to download the binaries: 504 Gateway Time-out.',
      },
      { code: 0, message: 'installed' },
    ])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(2)
  })

  it('retries npm install too, because pr-checks installs that way', () => {
    const result = install(
      [
        {
          code: 1,
          message: 'npm error Could not fetch checksum file 504 Gateway Time-out',
        },
        { code: 0, message: 'installed' },
      ],
      'npm install'
    )
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(2)
    expect(result.stdout).toContain('::warning::npm install')
  })

  it('waits 30 then 60 seconds by default, long enough to outlast a short burst', () => {
    const waits = path.join(fixture, 'waits')
    fs.writeFileSync(
      path.join(fixture, 'bin/sleep'),
      `#!/bin/sh\necho "$1" >> "${waits}"\n`,
      { mode: 0o755 }
    )
    const env: NodeJS.ProcessEnv = installEnvironment([
      { code: 1, message: 'ECONNRESET' },
    ])
    delete env.INSTALL_RETRY_DELAY_SECONDS
    const result = spawnSync('bash', [installScript], {
      cwd: fixture,
      encoding: 'utf8',
      env,
    })
    expect(result.status).toBe(1)
    expect(fs.readFileSync(waits, 'utf8').trim().split('\n')).toEqual(['30', '60'])
  })

  it('keeps a missing release red, because a 404 stays a 404', () => {
    const result = install([
      { code: 1, message: 'npm error Could not fetch checksum file 404 Not Found' },
    ])
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(1)
  })

  it('keeps deterministic install errors red without retrying', () => {
    const result = install([
      { code: 1, message: 'npm error code EUSAGE: lockfile mismatch' },
    ])
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(1)
  })

  it('stops after three failed downloads and preserves the error', () => {
    const result = install([{ code: 1, message: 'npm error code ETIMEDOUT' }])
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(3)
    expect(result.stdout).toContain('ETIMEDOUT')
  })

  it('runs custom commands containing tests once even when they report a network error', () => {
    const result = install([{ code: 1, message: 'ECONNRESET in a test' }], 'npm test')
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(1)
  })

  it('leaves successful installs at one attempt', () => {
    const result = install([{ code: 0, message: 'installed' }])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(1)
  })

  it('preserves a terminated npm process without retrying', () => {
    const result = install([{ code: 143, message: 'ECONNRESET', signal: 'SIGTERM' }])
    expect(result.status).toBe(143)
    expect(result.attempts).toBe(1)
  })

  it('stops when the wrapper is interrupted during an install', async () => {
    const child = spawn('bash', [installScript], {
      cwd: fixture,
      env: installEnvironment([{ code: 1, message: 'ECONNRESET', holdMs: 1000 }]),
    })
    let interrupted = false
    child.stdout.on('data', (chunk: Buffer) => {
      if (!interrupted && chunk.toString().includes('ECONNRESET')) {
        interrupted = child.kill('SIGINT')
      }
    })
    child.stderr.resume()
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('close', resolve)
      child.once('error', reject)
    })
    expect(interrupted).toBe(true)
    expect(code).toBe(130)
    expect(fs.readFileSync(path.join(fixture, 'attempts'), 'utf8')).toBe('1')
  })

  it('preserves an interrupted retry delay', () => {
    fs.writeFileSync(path.join(fixture, 'bin/sleep'), '#!/bin/sh\nexit 143\n', {
      mode: 0o755,
    })
    const result = install([{ code: 1, message: 'ECONNRESET' }])
    expect(result.status).toBe(143)
    expect(result.attempts).toBe(1)
  })

  it('routes the shared install action through the recovery script', () => {
    const action = fs.readFileSync(
      path.join(repoRoot, '.github/actions/install/action.yml'),
      'utf8'
    )
    expect(action).toContain('INSTALL_COMMAND: ${{ inputs.install-command }}')
    expect(action).toContain(
      'run: bash "${{ github.action_path }}/../../../scripts/ci/install-dependencies.sh"'
    )
  })

  it('routes the other setup action through the same script, with no retry of its own', () => {
    const action = fs.readFileSync(
      path.join(repoRoot, '.github/actions/setup-node-env/action.yml'),
      'utf8'
    )
    expect(action).toContain('INSTALL_COMMAND:')
    expect(action).toContain(
      'run: bash "${{ github.action_path }}/../../../scripts/ci/install-dependencies.sh"'
    )
    expect(action).not.toMatch(/for attempt/)
  })
})

describe('Maestro installer recovery', () => {
  const installerScript = path.join(repoRoot, 'scripts/maestro-install.mjs')
  const pinned = /MAESTRO_PINNED_VERSION = .*\?\? '([^']+)'/.exec(
    fs.readFileSync(path.join(repoRoot, 'scripts/maestro-version.mjs'), 'utf8')
  )?.[1] as string

  /** The installer fails until `succeedOn`, as a release host answering 504 does. */
  function runInstaller(succeedOn: number | null) {
    const home = path.join(fixture, 'home')
    const attempts = path.join(fixture, 'attempts')
    const waits = path.join(fixture, 'waits')
    fs.mkdirSync(home)
    const stub = (name: string, body: string) =>
      fs.writeFileSync(path.join(fixture, 'bin', name), `#!/bin/sh\n${body}\n`, {
        mode: 0o755,
      })
    stub('curl', 'exit 0')
    stub('sleep', `echo "$1" >> "${waits}"`)
    stub(
      'bash',
      `cat > /dev/null
count=$(cat "${attempts}" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "${attempts}"
[ "$count" = "${succeedOn ?? 0}" ] || exit 0
mkdir -p "$HOME/.maestro/bin"
printf '#!/bin/sh\\necho ${pinned}\\n' > "$HOME/.maestro/bin/maestro"
chmod +x "$HOME/.maestro/bin/maestro"`
    )
    const result = spawnSync(process.execPath, [installerScript], {
      encoding: 'utf8',
      env: {
        HOME: home,
        PATH: `${path.join(fixture, 'bin')}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      },
    })
    const read = (file: string) =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      attempts: Number(read(attempts)),
      waits: read(waits).split('\n').filter(Boolean),
    }
  }

  it.skipIf(process.platform === 'win32')(
    'retries an installer that left no binary, and waits between attempts',
    () => {
      const result = runInstaller(3)
      expect(result.status, result.output).toBe(0)
      expect(result.attempts).toBe(3)
      expect(result.waits).toEqual(['30', '60'])
    }
  )

  it.skipIf(process.platform === 'win32')('stops once the first attempt installs', () => {
    const result = runInstaller(1)
    expect(result.status, result.output).toBe(0)
    expect(result.attempts).toBe(1)
    expect(result.waits).toEqual([])
  })

  it.skipIf(process.platform === 'win32')(
    'fails after three attempts with no binary',
    () => {
      const result = runInstaller(null)
      expect(result.status).toBe(1)
      expect(result.attempts).toBe(3)
      expect(result.output).toContain(`expected ${pinned}`)
    }
  )
})

describe('Gradle distribution recovery', () => {
  const fetchScript = path.join(repoRoot, 'scripts/ci/fetch-gradle-wrapper.sh')
  const RELEASE_504 =
    'Exception in thread "main" java.io.IOException: Server returned HTTP response code: 504 for URL: https://github.com/gradle/gradle-distributions/releases/download/v8.14.3/gradle-8.14.3-bin.zip'

  /** A wrapper that answers each attempt from `results`, as one facing a release host does. */
  function fetchDistribution(results: InstallResult[]) {
    const project = path.join(fixture, 'android')
    const attempts = path.join(fixture, 'attempts')
    const waits = path.join(fixture, 'waits')
    fs.mkdirSync(project)
    fs.writeFileSync(
      path.join(project, 'gradlew'),
      `#!/usr/bin/env node
const fs = require('node:fs')
const count = fs.existsSync('${attempts}') ? Number(fs.readFileSync('${attempts}', 'utf8')) : 0
fs.writeFileSync('${attempts}', String(count + 1))
const results = ${JSON.stringify(results)}
const result = results[Math.min(count, results.length - 1)]
console.error(result.message)
process.exit(result.code)
`,
      { mode: 0o755 }
    )
    fs.writeFileSync(
      path.join(fixture, 'bin/sleep'),
      `#!/bin/sh\necho "$1" >> "${waits}"\n`,
      {
        mode: 0o755,
      }
    )
    const result = spawnSync('bash', [fetchScript, project], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(fixture, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    })
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      attempts: Number(fs.readFileSync(attempts, 'utf8')),
      waits: fs.existsSync(waits)
        ? fs.readFileSync(waits, 'utf8').trim().split('\n')
        : [],
    }
  }

  it('recovers the wrapper download that a gateway timeout broke', () => {
    const result = fetchDistribution([
      { code: 1, message: RELEASE_504 },
      { code: 0, message: 'Gradle 8.14.3' },
    ])
    expect(result.status, result.output).toBe(0)
    expect(result.attempts).toBe(2)
    expect(result.waits).toEqual(['30'])
    expect(result.output).toContain('::warning::')
  })

  it('stops after three attempts and keeps the error', () => {
    const result = fetchDistribution([{ code: 1, message: RELEASE_504 }])
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(3)
    expect(result.waits).toEqual(['30', '60'])
    expect(result.output).toContain('response code: 504')
  })

  it.each([
    [
      'a missing distribution',
      'Server returned HTTP response code: 404 for URL: https://x',
    ],
    ['a broken wrapper', 'Error: Could not find or load main class GradleWrapperMain'],
  ])('keeps %s red without retrying', (_name, message) => {
    const result = fetchDistribution([{ code: 1, message }])
    expect(result.status).toBe(1)
    expect(result.attempts).toBe(1)
    expect(result.waits).toEqual([])
  })

  it('leaves a working wrapper at one attempt', () => {
    const result = fetchDistribution([{ code: 0, message: 'Gradle 8.14.3' }])
    expect(result.status).toBe(0)
    expect(result.attempts).toBe(1)
  })

  it('fetches in both share-card lanes before their first Gradle call', () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/pr-share-card-native.yml'),
      'utf8'
    )
    const lanes = workflow.split('scripts/ci/fetch-gradle-wrapper.sh apps/mobile/android')
    expect(lanes).toHaveLength(3)
    expect(lanes[0]).not.toContain('./gradlew')
    expect(lanes[1]).toContain('./gradlew')
  })

  it('fetches in every Android job before the first Gradle step', () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/pr-accessibility-focus.yml'),
      'utf8'
    )
    const jobs = workflow.split(/\n {2}(?=[\w-]+:\n {4}name: )/)
    const android = jobs.filter((job) => job.includes('Generate the Android project'))
    // The app build, the module's Robolectric tests (split out to keep each under 20
    // minutes) and the TalkBack device run.
    expect(android).toHaveLength(3)
    for (const job of android) {
      const fetchAt = job.indexOf(
        'scripts/ci/fetch-gradle-wrapper.sh apps/mobile/android'
      )
      expect(fetchAt, job.slice(0, 60)).toBeGreaterThan(
        job.indexOf('Generate the Android project')
      )
      const firstGradle = job.search(
        /\.\/gradlew |Robolectric tests for the focus observer|accessibility-focus-device-tests\.sh/
      )
      expect(firstGradle, job.slice(0, 60)).toBeGreaterThan(-1)
      expect(fetchAt).toBeLessThan(firstGradle)
    }
  })
})
