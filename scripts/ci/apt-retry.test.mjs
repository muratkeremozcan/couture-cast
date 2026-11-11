// Learning path Step 54: Complimentary full access (CI apt retries).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { INSTALLERS, WRAPPER, unwrappedAptCalls } from './apt-retry-coverage.mjs'
import {
  APT_RETRIES_CONFIG,
  APT_RETRIES_FILE,
  boundedRun,
  configureAptRetries,
  parseAptRetryArgs,
  runAptCommand,
  withAptRetries,
} from './apt-retry.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const readRepo = (file) => readFileSync(path.join(repository, file), 'utf8')

/** A repository made of the given files, for the coverage walk. */
function fakeRepo(contents) {
  return {
    files: Object.keys(contents),
    read: (file) => contents[file],
    exists: (file) => file in contents,
  }
}

const workflow = (...runs) =>
  `jobs:\n  build:\n    steps:\n${runs
    .map(
      (run) =>
        `      - run: |\n${run
          .split('\n')
          .map((line) => `          ${line}`)
          .join('\n')}`
    )
    .join('\n')}\n`

describe('every apt install in CI retries', () => {
  test('no workflow, action or script they run calls apt outside the wrapper', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: repository, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    const { unwrapped, reached } = unwrappedAptCalls({
      files,
      read: readRepo,
      exists: (file) => existsSync(path.join(repository, file)),
    })
    assert.deepEqual(unwrapped, [])
    // The walk got somewhere: npm scripts, and the share-card installer the native lanes run.
    assert.ok(reached.length > 50, `reached ${reached.length}`)
    assert.ok(reached.includes('scripts/ci/share-card-browser-deps.mjs'))
    assert.ok(reached.some((entry) => entry.startsWith('npm:')))
  })

  test('direct, Playwright, continued and action apt calls are found and wrapped ones pass', () => {
    const repo = fakeRepo({
      '.github/workflows/w.yml': workflow(
        'sudo apt-get update && sudo apt-get install -y libfaketime',
        'npx playwright install --with-deps chromium &\nnpx playwright install-deps',
        'sudo apt \\\n  install -y jq',
        `node ${WRAPPER} --deadline-seconds 600 -- npx playwright install --with-deps chromium`,
        '# sudo apt-get install -y ignored\necho apt-cache-free'
      ),
      '.github/actions/a/action.yml':
        'runs:\n  using: composite\n  steps:\n    - run: sudo dpkg -i package.deb\n      shell: bash\n',
    })
    assert.deepEqual(unwrappedAptCalls(repo).unwrapped, [
      '.github/workflows/w.yml: sudo apt-get update',
      '.github/workflows/w.yml: sudo apt-get install -y libfaketime',
      '.github/workflows/w.yml: npx playwright install --with-deps chromium',
      '.github/workflows/w.yml: npx playwright install-deps',
      '.github/workflows/w.yml: sudo apt install -y jq',
      '.github/actions/a/action.yml: sudo dpkg -i package.deb',
    ])
  })

  test('a wrapped update chained with an unwrapped install is found', () => {
    const repo = fakeRepo({
      '.github/workflows/w.yml': workflow(
        `node ${WRAPPER} --deadline-seconds 600 -- sudo apt-get update && sudo apt-get install -y jq`
      ),
    })
    assert.deepEqual(unwrappedAptCalls(repo).unwrapped, [
      '.github/workflows/w.yml: sudo apt-get install -y jq',
    ])
  })

  test('the wrapper named in a comment does not wrap the command', () => {
    const repo = fakeRepo({
      '.github/workflows/w.yml': workflow(`sudo apt-get install -y jq # ${WRAPPER}`),
    })
    assert.deepEqual(unwrappedAptCalls(repo).unwrapped, [
      '.github/workflows/w.yml: sudo apt-get install -y jq',
    ])
  })

  test('apt in a repository script a step runs is found, unless the wrapper runs the script', () => {
    const installer = '#!/usr/bin/env bash\nset -e\nsudo apt-get install -y jq\n'
    const direct = fakeRepo({
      '.github/workflows/w.yml': workflow('bash scripts/install-packages.sh'),
      'scripts/install-packages.sh': installer,
    })
    assert.deepEqual(unwrappedAptCalls(direct).unwrapped, [
      'scripts/install-packages.sh: sudo apt-get install -y jq',
    ])
    const wrappedScript = fakeRepo({
      '.github/workflows/w.yml': workflow(
        `node ${WRAPPER} --deadline-seconds 600 -- bash scripts/install-packages.sh`
      ),
      'scripts/install-packages.sh': installer,
    })
    assert.deepEqual(unwrappedAptCalls(wrappedScript).unwrapped, [])
  })

  test('npm scripts, their pre scripts, workspaces and Node scripts are followed', () => {
    const repo = fakeRepo({
      '.github/workflows/w.yml': workflow(
        'npm run setup',
        'npm run deps --workspace api'
      ),
      'package.json': JSON.stringify({
        workspaces: ['apps/*'],
        scripts: { presetup: 'node scripts/fetch.mjs', setup: 'echo ready' },
      }),
      'apps/api/package.json': JSON.stringify({
        name: 'api',
        scripts: { deps: 'sudo apt-get install -y libvips' },
      }),
      'scripts/fetch.mjs': "spawnSync('sudo', ['apt-get', 'install', '-y', 'jq'])\n",
    })
    assert.deepEqual(unwrappedAptCalls(repo).unwrapped, [
      'scripts/fetch.mjs (run from .github/workflows/w.yml > npm run presetup): issues apt calls itself',
      '.github/workflows/w.yml > npm run deps -w api: sudo apt-get install -y libvips',
    ])
  })

  test('only the listed installers may issue apt calls themselves, and the share-card one retries', () => {
    assert.deepEqual(Object.keys(INSTALLERS).sort(), [
      'scripts/ci/apt-retry.mjs',
      'scripts/ci/share-card-browser-deps.mjs',
    ])
    const source = readRepo('scripts/ci/share-card-browser-deps.mjs')
    assert.match(
      source,
      /import \{[^}]*configureAptRetries[^}]*\} from '\.\/apt-retry\.mjs'/
    )
    assert.match(source, /withAptRetries\(/)
    assert.match(source, /configureAptRetries\(\)\n\s*installPinnedPlaywrightBrowsers/)
  })
})

describe('apt-retry wrapper', () => {
  test('writes apt fetch retries to the runner configuration', () => {
    const calls = []
    configureAptRetries({
      run: (...args) => {
        calls.push(args)
        return { status: 0 }
      },
    })
    assert.deepEqual(calls, [
      [
        'sudo',
        ['-n', 'tee', APT_RETRIES_FILE],
        { input: APT_RETRIES_CONFIG, stdio: ['pipe', 'ignore', 'pipe'], timeout: 10_000 },
      ],
    ])
    assert.match(APT_RETRIES_CONFIG, /Acquire::Retries "5";/)
    assert.throws(
      () => configureAptRetries({ run: () => ({ status: 1 }) }),
      /apt_retry_config_failed/
    )
  })

  test('retries after 15, 30, 60 and 120 s, then fails with the last error', () => {
    const slept = []
    let attempts = 0
    assert.throws(
      () =>
        withAptRetries(
          () => {
            attempts += 1
            throw new Error(`failure ${attempts}`)
          },
          { sleep: (seconds) => slept.push(seconds), log: () => undefined }
        ),
      /failure 5/
    )
    assert.deepEqual(slept, [15, 30, 60, 120])
  })

  test('returns as soon as an attempt succeeds', () => {
    let attempts = 0
    const slept = []
    withAptRetries(
      () => {
        attempts += 1
        if (attempts < 3) throw new Error('resolver down')
      },
      { sleep: (seconds) => slept.push(seconds), log: () => undefined }
    )
    assert.equal(attempts, 3)
    assert.deepEqual(slept, [15, 30])
  })

  test('never retries an error it is told is final', () => {
    let attempts = 0
    assert.throws(
      () =>
        withAptRetries(
          () => {
            attempts += 1
            throw new Error('timeout')
          },
          { retryable: () => false, sleep: () => undefined }
        ),
      /timeout/
    )
    assert.equal(attempts, 1)
  })

  test('starts no attempt the deadline cannot fit, and tells each one what remains', () => {
    let clock = 0
    const remaining = []
    assert.throws(
      () =>
        withAptRetries(
          ({ remainingSeconds }) => {
            remaining.push(remainingSeconds)
            clock += 100_000
            throw new Error('mirror down')
          },
          {
            deadlineSeconds: 300,
            now: () => clock,
            sleep: (seconds) => {
              clock += seconds * 1000
            },
            log: () => undefined,
          }
        ),
      /mirror down/
    )
    // 300, then 185 after 100 + 15, then 55 after 100 + 30: under a minute, so no third pause.
    assert.deepEqual(remaining, [300, 185])
  })

  test('the CLI configures apt, then runs each attempt under timeout with the KILL grace reserved', () => {
    const calls = []
    const results = [{ status: 100 }, { status: 0 }]
    runAptCommand(['--deadline-seconds', '600', '--', 'npx', 'playwright', 'install'], {
      configure: () => calls.push(['configure']),
      run: (command, args, options) => {
        calls.push([command, args, options.timeout, options.killSignal])
        return results.shift()
      },
      now: () => 0,
      sleep: () => undefined,
      log: () => undefined,
    })
    const attempt = [
      'timeout',
      ['--signal=TERM', '--kill-after=15s', '580s', 'npx', 'playwright', 'install'],
      600_000,
      'SIGKILL',
    ]
    assert.deepEqual(calls, [['configure'], attempt, attempt])
    assert.throws(
      () =>
        runAptCommand(['--deadline-seconds', '600', '--', 'false'], {
          configure: () => undefined,
          run: () => ({ status: 100 }),
          pauses: [],
        }),
      (error) => error.status === 100
    )
  })

  test('the time configuration took comes out of the deadline', () => {
    let clock = 0
    const budgets = []
    runAptCommand(['--deadline-seconds', '600', '--', 'true'], {
      configure: () => {
        clock += 9_000
      },
      run: (_command, args) => {
        budgets.push(args[2])
        return { status: 0 }
      },
      now: () => clock,
    })
    assert.deepEqual(budgets, ['571s'])
  })

  test('a pause that returns late starts no attempt the deadline no longer covers', () => {
    let clock = 0
    const budgets = []
    assert.throws(
      () =>
        runAptCommand(['--deadline-seconds', '100', '--', 'apt-get', 'update'], {
          configure: () => undefined,
          run: (_command, args) => {
            budgets.push(args[2])
            return { status: 100 }
          },
          now: () => clock,
          // Asked for 15 s, back after 99.5 s: half a second of the deadline is left.
          sleep: () => {
            clock += 99_500
          },
          log: () => undefined,
        }),
      (error) => error.status === 100
    )
    assert.deepEqual(budgets, ['80s'])
  })

  test('a finite budget is never passed as 0, which timeout reads as no limit', () => {
    for (const seconds of [0, -1, 0.5])
      assert.throws(
        () => boundedRun(() => ({ status: 0 }), 'true', [], { seconds }),
        /apt_retry_deadline_spent/
      )
  })

  test('a command and its children that ignore TERM are killed within the deadline', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'apt-retry-'))
    const pidFile = path.join(directory, 'grandchild.pid')
    const stubborn = path.join(directory, 'stubborn.mjs')
    writeFileSync(
      stubborn,
      `import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
process.on('SIGTERM', () => undefined)
const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000)"], { stdio: 'ignore' })
writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid))
setTimeout(() => {}, 30000)
`
    )
    const started = Date.now()
    try {
      assert.throws(
        () =>
          runAptCommand(['4', '--', process.execPath, stubborn], {
            // A 4 s deadline: 2 s of work, TERM, then KILL 1 s later, 1 s to spare.
            parse: (args) => ({
              deadlineSeconds: Number(args[0]),
              command: args[2],
              commandArgs: args.slice(3),
            }),
            configure: () => undefined,
            graceSeconds: 1,
            reserveSeconds: 2,
            pauses: [],
          }),
        /apt_backed_command_failed/
      )
      const elapsed = Date.now() - started
      assert.ok(elapsed < 4000, `ran ${elapsed} ms on a 4 s deadline`)
      const grandchild = Number(readFileSync(pidFile, 'utf8'))
      let alive = true
      for (let wait = 0; wait < 20 && alive; wait += 1) {
        try {
          process.kill(grandchild, 0)
          spawnSync('sleep', ['0.1'])
        } catch {
          alive = false
        }
      }
      assert.equal(alive, false, 'the grandchild outlived the attempt')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('the CLI needs a deadline and a command', () => {
    for (const args of [
      [],
      ['--'],
      ['npx'],
      ['--', 'npx', 'a'],
      ['--deadline-seconds', '30', '--', 'x'],
      ['--deadline-seconds', '600', '--'],
      ['-x', '--', 'y'],
    ])
      assert.throws(
        () => parseAptRetryArgs(args),
        /apt_retry_(command_required|options_invalid)/
      )
    assert.deepEqual(parseAptRetryArgs(['--deadline-seconds', '600', '--', 'npx', 'a']), {
      deadlineSeconds: 600,
      command: 'npx',
      commandArgs: ['a'],
    })
  })
})
