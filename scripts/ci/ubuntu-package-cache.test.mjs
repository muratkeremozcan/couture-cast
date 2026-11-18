// browser-acceptance and setup-playwright-browsers cache the Ubuntu package files their browser
// steps download. The key names
// everything that decides that package list, so a change to any of them starts a fresh cache.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const helper = () => import('./ubuntu-package-cache.mjs')
const script = fileURLToPath(new URL('./ubuntu-package-cache.mjs', import.meta.url))
const host = {
  runnerOs: 'Linux',
  runnerArch: 'X64',
  osRelease: 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n',
  playwrightVersion: '1.64.1',
  browsers: ['chromium', 'firefox', 'webkit'],
  week: '2026-W47',
}
// Wednesday 2026-11-18, in ISO week 47.
const now = new Date('2026-11-18T00:31:23Z')

describe('Ubuntu package cache key', () => {
  test('names the runner, the release, the pinned Playwright and the engines', async () => {
    const { packageCacheKey } = await helper()
    assert.equal(
      packageCacheKey(host),
      'ubuntu-packages-v1-Linux-X64-ubuntu24.04-playwright1.64.1-chromium-firefox-webkit-2026-W47'
    )
  })

  test('every input that changes the package list changes the key', async () => {
    const { packageCacheKey } = await helper()
    const base = packageCacheKey(host)
    for (const change of [
      { runnerArch: 'ARM64' },
      { osRelease: 'ID=ubuntu\nVERSION_ID="22.04"\n' },
      { osRelease: 'ID=debian\nVERSION_ID="12"\n' },
      { playwrightVersion: '1.65.0' },
      { browsers: ['chromium'] },
      { browsers: ['webkit'] },
      { week: '2026-W48' },
    ])
      assert.notEqual(
        packageCacheKey({ ...host, ...change }),
        base,
        JSON.stringify(change)
      )
  })

  test('refuses a missing or malformed input, so no key is shared by accident', async () => {
    const { packageCacheKey } = await helper()
    for (const change of [
      { runnerOs: '' },
      { runnerArch: undefined },
      { runnerArch: 'X64 extra' },
      { osRelease: 'ID=ubuntu\n' },
      { osRelease: 'VERSION_ID="24.04"\n' },
      { playwrightVersion: '' },
      { playwrightVersion: 'latest' },
      { browsers: ['firefox'] },
      { browsers: ['webkit', 'chromium'] },
      { browsers: [] },
      { week: undefined },
      { week: '2026-47' },
      { week: '2026-W47 extra' },
    ])
      assert.throws(
        () => packageCacheKey({ ...host, ...change }),
        /ubuntu_package_cache_key_input_required/,
        JSON.stringify(change)
      )
  })

  test('the cached directory sits under the runner temporary directory', async () => {
    const { packageCacheDirectory } = await helper()
    assert.equal(
      packageCacheDirectory({ RUNNER_TEMP: '/home/runner/work/_temp' }),
      '/home/runner/work/_temp/ubuntu-packages'
    )
    assert.throws(
      () => packageCacheDirectory({}),
      /ubuntu_package_cache_key_input_required/
    )
  })

  test('the command prints the key and path as step outputs for the selected engines', async () => {
    const { cacheOutputs } = await helper()
    const env = { RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', RUNNER_TEMP: '/runner/temp' }
    const read = { osRelease: host.osRelease, playwrightVersion: '1.64.1', now }
    assert.equal(
      cacheOutputs([], env, read),
      'key=ubuntu-packages-v1-Linux-X64-ubuntu24.04-playwright1.64.1-chromium-firefox-webkit-2026-W47\npath=/runner/temp/ubuntu-packages\n'
    )
    assert.match(
      cacheOutputs(['--chromium-only'], env, read),
      /^key=ubuntu-packages-v1-Linux-X64-ubuntu24\.04-playwright1\.64\.1-chromium-2026-W47\n/
    )
    assert.throws(
      () => cacheOutputs(['--webkit'], env, read),
      /browser_dependency_engine_selection_required/
    )
  })

  test('the --playwright form keys the engines apt-install.sh installs', async () => {
    const { cacheOutputs } = await helper()
    const env = { RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', RUNNER_TEMP: '/runner/temp' }
    const read = { osRelease: host.osRelease, playwrightVersion: '1.64.1', now }
    assert.equal(
      cacheOutputs(['--playwright', 'webkit'], env, read),
      'key=ubuntu-packages-v1-Linux-X64-ubuntu24.04-playwright1.64.1-webkit-2026-W47\npath=/runner/temp/ubuntu-packages\n'
    )
    for (const args of [
      ['--playwright'],
      ['--playwright', 'firefox'],
      ['--playwright', 'webkit', 'webkit'],
    ])
      assert.throws(
        () => cacheOutputs(args, env, read),
        /ubuntu_package_cache_key_input_required/,
        JSON.stringify(args)
      )
  })

  test('the week is the ISO 8601 week in UTC, so a fresh cache starts each Monday', async () => {
    const { isoWeek, cacheOutputs } = await helper()
    for (const [date, week] of [
      ['2026-11-18T00:31:23Z', '2026-W47'],
      ['2026-11-15T23:59:59Z', '2026-W46'],
      ['2026-11-16T00:00:00Z', '2026-W47'],
      ['2026-01-01T12:00:00Z', '2026-W01'],
      ['2027-01-01T12:00:00Z', '2026-W53'],
      ['2024-12-30T12:00:00Z', '2025-W01'],
    ])
      assert.equal(isoWeek(new Date(date)), week, date)
    const env = { RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', RUNNER_TEMP: '/runner/temp' }
    for (const bad of [undefined, new Date('not a date')])
      assert.throws(
        () =>
          cacheOutputs([], env, {
            osRelease: host.osRelease,
            playwrightVersion: '1.64.1',
            now: bad,
          }),
        /ubuntu_package_cache_key_input_required/,
        String(bad)
      )
  })

  // The same contract as browser-acceptance's wiring (share-card-browser-deps.test.mjs): a hit
  // hands apt-install.sh every package file of the exact package list, only a successful miss
  // saves, and nothing restores by prefix.
  test('setup-playwright-browsers restores the WebKit package files of its exact key and saves them only after a successful miss', async () => {
    const action = parse(
      await readFile(
        new URL(
          '../../.github/actions/setup-playwright-browsers/action.yml',
          import.meta.url
        ),
        'utf8'
      )
    )
    const steps = action.runs.steps
    const at = (predicate) => steps.findIndex(predicate)
    const key = at((step) => step.id === 'ubuntu_packages_key')
    const restore = at((step) => step.id === 'ubuntu_packages_cache')
    const install = at((step) => step.run?.includes('scripts/ci/apt-install.sh'))
    const save = at((step) => step.uses === 'actions/cache/save@v4')
    assert.ok(
      key >= 0 && key < restore && restore < install && install < save,
      `${key} ${restore} ${install} ${save}`
    )
    assert.equal(
      steps[key].run,
      'node scripts/ci/ubuntu-package-cache.mjs --playwright webkit >> "$GITHUB_OUTPUT"'
    )
    const cached = {
      key: '${{ steps.ubuntu_packages_key.outputs.key }}',
      path: '${{ steps.ubuntu_packages_key.outputs.path }}/*.deb',
    }
    assert.equal(steps[restore].uses, 'actions/cache/restore@v4')
    assert.deepEqual(steps[restore].with, cached)
    assert.deepEqual(steps[save].with, cached)
    // A composite step without `if` runs only when every earlier step succeeded, so a failed or
    // timed-out install never saves.
    assert.equal(
      steps[save].if,
      "${{ steps.ubuntu_packages_cache.outputs.cache-hit != 'true' }}"
    )
    assert.equal(
      steps[install].env?.APT_INSTALL_ARCHIVES,
      '${{ steps.ubuntu_packages_key.outputs.path }}'
    )
    assert.match(
      steps[install].run,
      /^timeout --kill-after=10 600 bash scripts\/ci\/apt-install\.sh --playwright webkit$/m
    )
    for (const step of [key, restore, install]) assert.equal(steps[step].if, undefined)
    assert.equal(
      steps.filter((step) => /^actions\/cache\/(restore|save)@/.test(String(step.uses)))
        .length,
      2
    )
  })

  test('outside a runner the command fails and prints no key', () => {
    const result = spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /ubuntu_package_cache_key_input_required/)
  })
})
