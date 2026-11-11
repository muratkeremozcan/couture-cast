// Learning path Step 54: Complimentary full access (CI apt retries).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  APT_RETRIES_CONFIG,
  APT_RETRIES_FILE,
  configureAptRetries,
  parseAptRetryArgs,
  runAptCommand,
  withAptRetries,
} from './apt-retry.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const WRAPPER = 'scripts/ci/apt-retry.mjs'
/** apt itself, dpkg installs, and Playwright's installers that run apt for their system packages. */
const APT_CALL = /\bapt(?:-get)?(?:\s|$)|\bdpkg\s+-i\b|--with-deps\b|\binstall-deps\b/

/** Every `run` block of every step in a workflow or composite action. */
function runBlocks(document) {
  const blocks = []
  for (const job of Object.values(document?.jobs ?? {}))
    for (const step of job?.steps ?? [])
      if (typeof step?.run === 'string') blocks.push(step.run)
  for (const step of document?.runs?.steps ?? [])
    if (typeof step?.run === 'string') blocks.push(step.run)
  return blocks
}

/** Shell commands of a run block, with backslash continuations joined and comments dropped. */
function commands(block) {
  return block
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line && !line.startsWith('#'))
}

/** Each apt call under .github that does not go through the wrapper, as `file: command`. */
export function unwrappedAptCalls(files, read) {
  const found = []
  for (const file of files)
    for (const block of runBlocks(parse(read(file))))
      for (const command of commands(block))
        if (APT_CALL.test(command) && !command.includes(WRAPPER))
          found.push(`${file}: ${command}`)
  return found
}

function githubYamlFiles() {
  const files = []
  const visit = (relative) => {
    for (const entry of readdirSync(path.join(repository, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) visit(child)
      else if (/\.ya?ml$/.test(entry.name)) files.push(child)
    }
  }
  visit('.github')
  return files
}

const readRepo = (file) => readFileSync(path.join(repository, file), 'utf8')

describe('every apt install in CI retries', () => {
  test('no workflow or action under .github runs apt outside the wrapper', () => {
    const files = githubYamlFiles()
    assert.ok(files.length > 10, 'found the workflows')
    assert.deepEqual(unwrappedAptCalls(files, readRepo), [])
  })

  test('the check finds direct, Playwright and continued apt calls, and passes wrapped ones', () => {
    const workflow = `
jobs:
  build:
    steps:
      - run: sudo apt-get update && sudo apt-get install -y libfaketime
      - run: |
          npx playwright install --with-deps chromium &
          npx playwright install-deps
      - run: |
          sudo apt \\
            install -y jq
      - run: node ${WRAPPER} --deadline-seconds 600 -- npx playwright install --with-deps chromium
      - run: |
          # sudo apt-get install -y ignored
          echo apt-cache-free
`
    const action = `
runs:
  using: composite
  steps:
    - run: sudo dpkg -i package.deb
      shell: bash
`
    const files = { 'w.yml': workflow, 'a.yml': action }
    assert.deepEqual(
      unwrappedAptCalls(Object.keys(files), (file) => files[file]),
      [
        'w.yml: sudo apt-get update && sudo apt-get install -y libfaketime',
        'w.yml: npx playwright install --with-deps chromium &',
        'w.yml: npx playwright install-deps',
        'w.yml: sudo apt install -y jq',
        'a.yml: sudo dpkg -i package.deb',
      ]
    )
  })

  test('the share-card installer, which runs Playwright itself, goes through the wrapper', () => {
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

  test('the CLI configures apt, runs the command under the deadline and keeps its exit status', () => {
    const calls = []
    const results = [{ status: 100 }, { status: 0 }]
    runAptCommand(['--deadline-seconds', '600', '--', 'npx', 'playwright', 'install'], {
      configure: () => calls.push(['configure']),
      run: (command, args, options) => {
        calls.push([command, args, options.timeout])
        return results.shift()
      },
      now: () => 0,
      sleep: () => undefined,
      log: () => undefined,
    })
    assert.deepEqual(calls, [
      ['configure'],
      ['npx', ['playwright', 'install'], 600_000],
      ['npx', ['playwright', 'install'], 600_000],
    ])
    assert.throws(
      () =>
        runAptCommand(['--', 'false'], {
          configure: () => undefined,
          run: () => ({ status: 100 }),
          pauses: [],
        }),
      (error) => error.status === 100
    )
  })

  test('the CLI refuses a missing command or an unknown option', () => {
    for (const args of [
      [],
      ['--'],
      ['npx'],
      ['--deadline-seconds', '30', '--', 'x'],
      ['-x', '--', 'y'],
    ])
      assert.throws(
        () => parseAptRetryArgs(args),
        /apt_retry_(command_required|options_invalid)/
      )
    assert.deepEqual(parseAptRetryArgs(['--', 'npx', 'a']), {
      deadlineSeconds: Infinity,
      command: 'npx',
      commandArgs: ['a'],
    })
  })
})
