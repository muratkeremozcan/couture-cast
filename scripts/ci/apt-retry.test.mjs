// Learning path Step 54: Complimentary full access (CI apt retries).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ALLOWLIST, WRAPPER, aptInventory, shellCommands } from './apt-retry-coverage.mjs'
import {
  APT_RETRIES_CONFIG,
  APT_RETRIES_FILE,
  configureAptRetries,
  parseAptRetryArgs,
  runAptCommand,
  superviseCommand,
  withAptRetries,
} from './apt-retry.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const readRepo = (file) => readFileSync(path.join(repository, file), 'utf8')
const trackedFiles = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repository,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

/** The real repository with `changes` applied, as the inventory reads it. */
function repoWith(changes = {}) {
  const files = [...new Set([...trackedFiles(), ...Object.keys(changes)])]
  return {
    files,
    read: (file) => (file in changes ? changes[file] : readRepo(file)),
  }
}

const step = (run) =>
  `jobs:\n  build:\n    steps:\n      - run: |\n${run
    .split('\n')
    .map((line) => `          ${line}`)
    .join('\n')}\n`
const unwrappedWith = (changes) => aptInventory(repoWith(changes)).unwrapped.sort()

describe('every apt call in CI is wrapped or reviewed', () => {
  test('the repository has none outside the wrapper and the reviewed allowlist', () => {
    assert.deepEqual(aptInventory(repoWith()), { unwrapped: [], stale: [] })
  })

  test('the allowlist is pinned, and the share-card installer in it retries under the supervisor', () => {
    assert.deepEqual(Object.keys(ALLOWLIST).sort(), [
      'scripts/ci/apt-retry-coverage.mjs',
      'scripts/ci/apt-retry.mjs',
      'scripts/ci/apt-retry.test.mjs',
      'scripts/ci/share-card-browser-deps.mjs',
      'scripts/ci/share-card-browser-deps.test.mjs',
    ])
    const source = readRepo('scripts/ci/share-card-browser-deps.mjs')
    assert.match(
      source,
      /configureAptRetries\(\)\n\s*await installPinnedPlaywrightBrowsers/
    )
    assert.match(source, /await withAptRetries\(/)
    assert.match(source, /supervise = superviseCommand/)
  })

  test('apt appended to install-dependencies.sh, which the install actions run by a quoted action path, is found', () => {
    const file = 'scripts/ci/install-dependencies.sh'
    assert.deepEqual(
      unwrappedWith({ [file]: `${readRepo(file)}sudo apt-get install -y jq\n` }),
      [`${file}: sudo apt-get install -y jq`]
    )
  })

  test('apt in a script a step runs by a quoted path is found', () => {
    assert.deepEqual(
      unwrappedWith({
        '.github/workflows/zz-probe.yml': step('bash "scripts/zz-install.sh"'),
        'scripts/zz-install.sh': '#!/usr/bin/env bash\nsudo apt-get install -y jq\n',
      }),
      ['scripts/zz-install.sh: sudo apt-get install -y jq']
    )
  })

  test('apt in a helper a Node script imports by a relative path is found', () => {
    assert.deepEqual(
      unwrappedWith({
        'scripts/zz-entry.mjs': "import './zz-install.mjs'\n",
        'scripts/zz-install.mjs':
          "spawnSync('sudo', ['apt-get', 'install', '-y', 'jq'])\n",
      }),
      ["scripts/zz-install.mjs: spawnSync('sudo', ['apt-get', 'install', '-y', 'jq'])"]
    )
  })

  test('a wrapped update chained with an unwrapped install, and the wrapper only in a comment, are found', () => {
    assert.deepEqual(
      unwrappedWith({
        '.github/workflows/zz-probe.yml': step(
          `node ${WRAPPER} --deadline-seconds 600 -- sudo apt-get update && sudo apt-get install -y jq\nsudo apt-get install -y curl # ${WRAPPER}`
        ),
      }),
      [
        '.github/workflows/zz-probe.yml: sudo apt-get install -y curl',
        '.github/workflows/zz-probe.yml: sudo apt-get install -y jq',
      ]
    )
  })

  test('a command list quoted inside the wrapper is one wrapped command', () => {
    assert.deepEqual(
      unwrappedWith({
        '.github/workflows/zz-probe.yml': step(
          `node ${WRAPPER} --deadline-seconds 600 -- bash -c 'sudo apt-get update && sudo apt-get install -y jq'\nnode "\${{ github.workspace }}/${WRAPPER}" --deadline-seconds 600 -- npx playwright install --with-deps chromium`
        ),
      }),
      []
    )
  })

  test('direct, Playwright, continued, action and npm script calls are found', () => {
    const packageJson = JSON.parse(readRepo('package.json'))
    packageJson.scripts['zz:deps'] = 'npx playwright install-deps'
    assert.deepEqual(
      unwrappedWith({
        '.github/workflows/zz-probe.yml': step(
          'npx playwright install --with-deps chromium &\nsudo apt \\\n  install -y jq'
        ),
        '.github/actions/zz-probe/action.yml':
          'runs:\n  using: composite\n  steps:\n    - run: sudo dpkg -i package.deb\n      shell: bash\n',
        'package.json': JSON.stringify(packageJson),
      }),
      [
        '.github/actions/zz-probe/action.yml: sudo dpkg -i package.deb',
        '.github/workflows/zz-probe.yml: npx playwright install --with-deps chromium',
        '.github/workflows/zz-probe.yml: sudo apt install -y jq',
        'package.json scripts.zz:deps: npx playwright install-deps',
      ]
    )
  })

  test('an allowlisted file that no longer calls apt is reported, so the list stays exact', () => {
    assert.deepEqual(
      aptInventory(
        repoWith({ 'scripts/ci/share-card-browser-deps.test.mjs': '// gone\n' })
      ).stale,
      ['scripts/ci/share-card-browser-deps.test.mjs']
    )
  })

  test('shell commands honour quotes, escapes, comments and continuations', () => {
    assert.deepEqual(
      shellCommands('a \'b && c\' && d "e;f" ; g\\\n h # i && j\nk 2>&1 | l & m'),
      ["a 'b && c'", 'd "e;f"', 'g h', 'k 2>&1', 'l', 'm']
    )
  })
})

/** A Node script in a temporary directory; returns its path. */
function script(directory, name, body) {
  const file = path.join(directory, name)
  writeFileSync(file, body)
  return file
}

/** Whether `pid` is still a live process (not a zombie). */
function alive(pid) {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
  return !String(state.stdout).trim().startsWith('Z')
}

describe('apt-retry supervisor', () => {
  for (const [name, parentIgnoresTerm] of [
    ['a parent and child that both ignore TERM', true],
    ['a child that ignores TERM after its parent exits on it', false],
  ])
    test(`${name} are killed at the deadline`, async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'apt-retry-'))
      const pidFile = path.join(directory, 'child.pid')
      const parent = script(
        directory,
        'parent.mjs',
        `import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
${parentIgnoresTerm ? "process.on('SIGTERM', () => undefined)" : ''}
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' })
writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
setInterval(() => {}, 1000)
`
      )
      try {
        const started = Date.now()
        const result = await superviseCommand(process.execPath, [parent], {
          seconds: 1.5,
          graceSeconds: 1,
        })
        const elapsed = Date.now() - started
        assert.deepEqual(result, { status: 124, timedOut: true })
        assert.ok(elapsed < 4500, `ran ${elapsed} ms for 1.5 s plus 1 s of grace`)
        const child = Number(readFileSync(pidFile, 'utf8'))
        let survived = alive(child)
        for (let wait = 0; wait < 20 && survived; wait += 1) {
          spawnSync('sleep', ['0.1'])
          survived = alive(child)
        }
        assert.equal(survived, false, 'the child outlived the deadline')
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })

  test('a command that finishes in time keeps its exit status', async () => {
    assert.deepEqual(
      await superviseCommand(process.execPath, ['-e', 'process.exit(3)'], {
        seconds: 10,
      }),
      { status: 3, signal: null }
    )
  })

  test('a budget of 0 or less is refused, never passed on as no limit', async () => {
    for (const seconds of [0, -1, Number.NaN])
      await assert.rejects(
        superviseCommand('true', [], { seconds, start: () => assert.fail('started') }),
        /apt_retry_deadline_spent/
      )
  })

  test('the CLI runs the same supervisor end to end, inside its deadline', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'apt-retry-'))
    const stubborn = script(
      directory,
      'stubborn.mjs',
      "process.on('SIGTERM', () => undefined)\nsetInterval(() => {}, 1000)\n"
    )
    try {
      const started = Date.now()
      await assert.rejects(
        runAptCommand(['4', '--', process.execPath, stubborn], {
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
        (error) => error.status === 124
      )
      assert.ok(Date.now() - started < 4000)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('apt-retry wrapper', () => {
  const quiet = { log: () => undefined }

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

  test('retries after 15, 30, 60 and 120 s, then fails with the last error', async () => {
    const slept = []
    let attempts = 0
    await assert.rejects(
      withAptRetries(
        async () => {
          attempts += 1
          throw new Error(`failure ${attempts}`)
        },
        { sleep: async (seconds) => slept.push(seconds), ...quiet }
      ),
      /failure 5/
    )
    assert.deepEqual(slept, [15, 30, 60, 120])
  })

  test('returns as soon as an attempt succeeds, and never retries a final error', async () => {
    let attempts = 0
    await withAptRetries(
      async () => {
        attempts += 1
        if (attempts < 3) throw new Error('resolver down')
      },
      { sleep: async () => undefined, ...quiet }
    )
    assert.equal(attempts, 3)
    let finals = 0
    await assert.rejects(
      withAptRetries(
        async () => {
          finals += 1
          throw new Error('timeout')
        },
        { retryable: () => false, sleep: async () => undefined }
      ),
      /timeout/
    )
    assert.equal(finals, 1)
  })

  test('the CLI reserves the KILL grace, deducts configuration time and rereads the deadline after a late pause', async () => {
    let clock = 0
    const budgets = []
    await assert.rejects(
      runAptCommand(['--deadline-seconds', '120', '--', 'apt-get', 'update'], {
        configure: () => {
          clock += 9_000
        },
        supervise: async (_command, _args, { seconds }) => {
          budgets.push(seconds)
          return { status: 100 }
        },
        now: () => clock,
        // Asked for 15 s, back after 110.5 s: half a second of the deadline is left.
        sleep: async () => {
          clock += 110_500
        },
        ...quiet,
      }),
      (error) => error.status === 100
    )
    // 120 s, less 9 s of configuration, less the 20 s reserve.
    assert.deepEqual(budgets, [91])
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
