// Learning path Step 54: Complimentary full access (CI apt retries).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
//
// CI installs Ubuntu packages in one place, scripts/ci/apt-install.sh. Its calls (apt-get, apt with
// a verb, dpkg -i, Playwright's dependency installer) may appear nowhere else under .github or
// scripts, nor in a package.json script, except in the reviewed ALLOWLIST below. The search is
// plain text, line by line, so a new line anywhere fails until it goes through the script or is
// reviewed into the list, however a workflow would reach it.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = 'scripts/ci/apt-install.sh'
const APT_CALL = new RegExp(
  [
    'apt-get',
    String.raw`\bapt\s+(?:install|update|upgrade|full-upgrade|dist-upgrade|remove|purge|autoremove)\b`,
    String.raw`\bdpkg\s+-i\b`,
    'install-deps',
    '--with-deps',
  ].join('|')
)

/** Files allowed to name those calls, and why. */
const ALLOWLIST = {
  [SCRIPT]: 'the one place CI installs Ubuntu packages',
  'scripts/ci/apt-install.test.mjs': 'this guard: its pattern and its red cases',
  'scripts/ci/share-card-browser-deps.test.mjs':
    'asserts the share-card workflows run no direct Playwright package install',
}

const tracked = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repository,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

/**
 * Every hit outside the allowlist, as `file:line: text`, and every allowlisted file without a hit.
 *
 * @param {string[]} files
 * @param {(file: string) => string} read
 */
function inventory(files, read) {
  const hits = []
  const listed = new Set()
  for (const file of files) {
    if (/(?:^|\/)package\.json$/.test(file) && !file.includes('node_modules/')) {
      for (const [name, body] of Object.entries(JSON.parse(read(file)).scripts ?? {}))
        if (APT_CALL.test(String(body))) hits.push(`${file} scripts.${name}: ${body}`)
      continue
    }
    if (!/^(?:\.github|scripts)\//.test(file)) continue
    read(file)
      .split('\n')
      .forEach((line, index) => {
        if (!APT_CALL.test(line)) return
        if (file in ALLOWLIST) listed.add(file)
        else hits.push(`${file}:${index + 1}: ${line.trim()}`)
      })
  }
  const stale = Object.keys(ALLOWLIST).filter((file) => !listed.has(file))
  return { hits, stale }
}

/** The repository with `changes` applied. */
function repoWith(changes = {}) {
  const files = [...new Set([...tracked(), ...Object.keys(changes)])]
  const read = (file) =>
    file in changes ? changes[file] : readFileSync(path.join(repository, file), 'utf8')
  return inventory(files, read)
}

const original = (file) => readFileSync(path.join(repository, file), 'utf8')

describe('CI installs Ubuntu packages only through apt-install.sh', () => {
  test('no other file under .github or scripts, and no package.json script, names an apt call', () => {
    assert.deepEqual(repoWith(), { hits: [], stale: [] })
  })

  test('the allowlist is pinned', () => {
    assert.deepEqual(Object.keys(ALLOWLIST).sort(), [
      'scripts/ci/apt-install.sh',
      'scripts/ci/apt-install.test.mjs',
      'scripts/ci/share-card-browser-deps.test.mjs',
    ])
  })

  test('an apt line added to a workflow fails', () => {
    const file = '.github/workflows/pr-checks.yml'
    const { hits } = repoWith({
      [file]: `${original(file)}# sudo apt-get install -y jq\n`,
    })
    assert.equal(hits.length, 1)
    assert.match(
      hits[0],
      /^\.github\/workflows\/pr-checks\.yml:\d+: # sudo apt-get install -y jq$/
    )
  })

  test('an apt line added to install-dependencies.sh fails', () => {
    const file = 'scripts/ci/install-dependencies.sh'
    const { hits } = repoWith({ [file]: `${original(file)}sudo apt-get install -y jq\n` })
    assert.equal(hits.length, 1)
    assert.match(
      hits[0],
      /^scripts\/ci\/install-dependencies\.sh:\d+: sudo apt-get install -y jq$/
    )
  })

  test('a Node script that runs the Playwright package installer itself fails', () => {
    const { hits } = repoWith({
      'scripts/zz-install.mjs':
        "spawnSync('npx', ['playwright', 'install-deps', 'chromium'])\n",
    })
    assert.deepEqual(hits, [
      "scripts/zz-install.mjs:1: spawnSync('npx', ['playwright', 'install-deps', 'chromium'])",
    ])
  })

  test('a package.json script that installs packages fails', () => {
    const manifest = JSON.parse(original('package.json'))
    manifest.scripts['zz:deps'] = 'sudo dpkg -i ./package.deb'
    assert.deepEqual(repoWith({ 'package.json': JSON.stringify(manifest) }).hits, [
      'package.json scripts.zz:deps: sudo dpkg -i ./package.deb',
    ])
  })

  test('an allowlisted file that no longer names an apt call fails, so the list stays exact', () => {
    assert.deepEqual(
      repoWith({ 'scripts/ci/share-card-browser-deps.test.mjs': '// gone\n' }).stale,
      ['scripts/ci/share-card-browser-deps.test.mjs']
    )
  })

  test('the script never signals or times out anything: the step timeout bounds it', () => {
    const body = original(SCRIPT)
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    assert.doesNotMatch(body, /\bkill\b|\btimeout\b|\btrap\b/)
  })
})

/**
 * Runs apt-install.sh with stub `sudo`, `npx` and `sleep` on PATH. `statuses` are the exit codes of
 * successive install commands (0 once they run out). Returns the exit status, the commands run,
 * the pauses taken and what was written to apt's configuration.
 */
function runScript(args, { statuses = [], teeStatus = 0, pauses = '1 2' } = {}) {
  const stubs = mkdtempSync(path.join(os.tmpdir(), 'apt-install-'))
  const stub = (name, body) => {
    const file = path.join(stubs, name)
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(file, 0o755)
  }
  writeFileSync(path.join(stubs, 'statuses'), statuses.map(String).join('\n'))
  const next = `status=$(head -n 1 "${stubs}/statuses"); tail -n +2 "${stubs}/statuses" > "${stubs}/rest"; mv "${stubs}/rest" "${stubs}/statuses"; exit "\${status:-0}"`
  stub(
    'sudo',
    `[ "$1" = -n ] && shift
if [ "$1" = tee ]; then cat > "${stubs}/tee"; exit ${teeStatus}; fi
echo "sudo $*" >> "${stubs}/calls"
${next}`
  )
  stub('npx', `echo "npx $*" >> "${stubs}/calls"\n${next}`)
  stub('sleep', `echo "$1" >> "${stubs}/sleeps"`)
  try {
    const result = spawnSync('bash', [path.join(repository, SCRIPT), ...args], {
      env: { PATH: `${stubs}:${process.env.PATH}`, APT_INSTALL_PAUSES: pauses },
      encoding: 'utf8',
    })
    const read = (name) => {
      try {
        return readFileSync(path.join(stubs, name), 'utf8')
      } catch {
        return ''
      }
    }
    const lines = (name) => read(name).split('\n').filter(Boolean)
    return {
      status: result.status,
      calls: lines('calls'),
      sleeps: lines('sleeps'),
      config: read('tee'),
      stderr: result.stderr,
    }
  } finally {
    rmSync(stubs, { recursive: true, force: true })
  }
}

describe('apt-install.sh', () => {
  test("writes apt's own retries and timeouts before installing", () => {
    const { status, config } = runScript(['--playwright', 'chromium'])
    assert.equal(status, 0)
    assert.equal(
      config,
      'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n'
    )
  })

  test("runs Playwright's package installer again after each pause until it succeeds", () => {
    const { status, calls, sleeps } = runScript(['--playwright', 'chromium'], {
      statuses: [100, 100, 0],
    })
    assert.equal(status, 0)
    assert.deepEqual(
      calls,
      Array(3).fill('npx --no-install playwright install-deps chromium')
    )
    assert.deepEqual(sleeps, ['1', '2'])
  })

  test('gives up after the last pause with the last exit status', () => {
    const { status, calls, sleeps, stderr } = runScript(['--playwright', 'chromium'], {
      statuses: [100, 100, 7],
    })
    assert.equal(status, 7)
    assert.equal(calls.length, 3)
    assert.deepEqual(sleeps, ['1', '2'])
    assert.match(stderr, /failed 3 times; the last exit status was 7/)
  })

  test('installs Ubuntu packages with an index update first, and retries the pair', () => {
    const { status, calls } = runScript(['jq', 'curl'], { statuses: [100, 0, 0] })
    assert.equal(status, 0)
    assert.deepEqual(calls, [
      'sudo apt-get update',
      'sudo apt-get update',
      'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jq curl',
    ])
  })

  test('refuses missing arguments and malformed pauses, and stops when apt cannot be configured', () => {
    assert.equal(runScript([]).status, 2)
    assert.equal(runScript(['--playwright']).status, 2)
    assert.equal(runScript(['jq'], { pauses: '1 soon' }).status, 2)
    const unconfigured = runScript(['jq'], { teeStatus: 1 })
    assert.equal(unconfigured.status, 1)
    assert.deepEqual(unconfigured.calls, [])
  })
})
