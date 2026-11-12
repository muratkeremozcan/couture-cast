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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = 'scripts/ci/apt-install.sh'
// Any whole-word mention of the package tools, however it is spelled around them (`sudo apt -y
// install`, `spawnSync('apt', ['install'])`), and Playwright's package installer. `apt-install.sh`
// is not a mention: a hyphen joins it to the rest of the name.
const APT_CALL = new RegExp(
  [
    String.raw`(?<![\w-])(?:apt|apt-get|aptitude|dpkg)(?![\w-])`,
    'install-deps',
    '--with-deps',
  ].join('|')
)

/** Files allowed to name those calls, and why. */
const ALLOWLIST = {
  [SCRIPT]: 'the one place CI installs Ubuntu packages',
  'scripts/ci/apt-install.test.mjs': 'this guard: its pattern and its red cases',
  'scripts/ci/share-card-browser-deps.mjs':
    'points /etc/apt sources at the official archive and restores them; installs through apt-install.sh',
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
      'scripts/ci/share-card-browser-deps.mjs',
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

  test('apt with options before its verb, and apt as a quoted Node argument, fail', () => {
    assert.deepEqual(
      repoWith({
        '.github/workflows/zz-probe.yml':
          'jobs:\n  b:\n    steps:\n      - run: sudo apt -y install jq\n',
        'scripts/zz-install.mjs': "spawnSync('sudo', ['apt', 'install', '-y', 'jq'])\n",
        'scripts/zz-other.mjs': 'spawnSync("dpkg", ["--configure", "-a"])\n',
      }).hits.sort(),
      [
        '.github/workflows/zz-probe.yml:4: - run: sudo apt -y install jq',
        "scripts/zz-install.mjs:1: spawnSync('sudo', ['apt', 'install', '-y', 'jq'])",
        'scripts/zz-other.mjs:1: spawnSync("dpkg", ["--configure", "-a"])',
      ]
    )
  })

  test("the script's own name is not a mention", () => {
    assert.deepEqual(
      repoWith({
        'scripts/zz-entry.sh': 'bash scripts/ci/apt-install.sh --playwright chromium\n',
      }).hits,
      []
    )
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
 * the pauses taken and what was written to apt's configuration. With APT_INSTALL_ARCHIVES in
 * `env`, each recorded install also says how many package files that directory held.
 */
function runScript(
  args,
  { statuses = [], teeStatus = 0, pauses = '1 2', env = {} } = {}
) {
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
  const held =
    '${APT_INSTALL_ARCHIVES:+ holding $(find "$APT_INSTALL_ARCHIVES" -maxdepth 1 -name "*.deb" | wc -l | tr -d " ")}'
  stub('npx', `echo "npx $*${held}" >> "${stubs}/calls"\n${next}`)
  stub('sleep', `echo "$1" >> "${stubs}/sleeps"`)
  try {
    const result = spawnSync('bash', [path.join(repository, SCRIPT), ...args], {
      env: { PATH: `${stubs}:${process.env.PATH}`, APT_INSTALL_PAUSES: pauses, ...env },
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

  // browser-acceptance restores the package files of its last miss into this directory, so a
  // cache hit downloads none of them again.
  test('keeps downloaded package files in APT_INSTALL_ARCHIVES when it is set', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'apt-archives-'))
    try {
      const archives = path.join(directory, 'ubuntu-packages')
      const { status, config, calls } = runScript(['--playwright', 'chromium'], {
        env: { APT_INSTALL_ARCHIVES: archives },
      })
      assert.equal(status, 0)
      assert.equal(
        config,
        `Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nDir::Cache::Archives "${archives}/";\n`
      )
      assert.ok(existsSync(path.join(archives, 'partial')))
      assert.deepEqual(calls, [
        'npx --no-install playwright install-deps chromium holding 0',
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('a failed install drops the restored package files, so the retry downloads them all', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'apt-archives-'))
    try {
      const archives = path.join(directory, 'ubuntu-packages')
      mkdirSync(archives)
      for (const name of ['libone_1.0_amd64.deb', 'libtwo_2.0_amd64.deb', 'notes.txt'])
        writeFileSync(path.join(archives, name), 'restored')
      const { status, calls, sleeps } = runScript(['--playwright', 'chromium'], {
        statuses: [100, 0],
        env: { APT_INSTALL_ARCHIVES: archives },
      })
      assert.equal(status, 0)
      assert.deepEqual(calls, [
        'npx --no-install playwright install-deps chromium holding 2',
        'npx --no-install playwright install-deps chromium holding 0',
      ])
      assert.deepEqual(sleeps, ['1'])
      assert.ok(existsSync(path.join(archives, 'notes.txt')))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('refuses an archive directory that is relative or has characters apt would misread', () => {
    for (const archives of ['relative/packages', '/tmp/with space', '/tmp/quote"d']) {
      const { status, calls, config } = runScript(['jq'], {
        env: { APT_INSTALL_ARCHIVES: archives },
      })
      assert.equal(status, 2, archives)
      assert.deepEqual(calls, [], archives)
      assert.equal(config, '', archives)
    }
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
