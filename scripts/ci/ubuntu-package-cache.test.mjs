// browser-acceptance caches the Ubuntu package files its browser step downloads. The key names
// everything that decides that package list, so a change to any of them starts a fresh cache.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const helper = () => import('./ubuntu-package-cache.mjs')
const script = fileURLToPath(new URL('./ubuntu-package-cache.mjs', import.meta.url))
const host = {
  runnerOs: 'Linux',
  runnerArch: 'X64',
  osRelease: 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n',
  playwrightVersion: '1.64.1',
  browsers: ['chromium', 'firefox', 'webkit'],
}

describe('Ubuntu package cache key', () => {
  test('names the runner, the release, the pinned Playwright and the engines', async () => {
    const { packageCacheKey } = await helper()
    assert.equal(
      packageCacheKey(host),
      'ubuntu-packages-v1-Linux-X64-ubuntu24.04-playwright1.64.1-chromium-firefox-webkit'
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
      { browsers: [] },
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
    const read = { osRelease: host.osRelease, playwrightVersion: '1.64.1' }
    assert.equal(
      cacheOutputs([], env, read),
      'key=ubuntu-packages-v1-Linux-X64-ubuntu24.04-playwright1.64.1-chromium-firefox-webkit\npath=/runner/temp/ubuntu-packages\n'
    )
    assert.match(
      cacheOutputs(['--chromium-only'], env, read),
      /^key=ubuntu-packages-v1-Linux-X64-ubuntu24\.04-playwright1\.64\.1-chromium\n/
    )
    assert.throws(
      () => cacheOutputs(['--webkit'], env, read),
      /browser_dependency_engine_selection_required/
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
