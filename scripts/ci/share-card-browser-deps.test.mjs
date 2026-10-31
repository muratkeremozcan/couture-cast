import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { runGatesTestFile } from './node-test-gate.mjs'

const helper = () => import('./share-card-browser-deps.mjs')
const legacy = 'deb http://azure.archive.ubuntu.com/ubuntu noble main universe\n'
const deb822 =
  'Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
const official = (text) =>
  text.replaceAll('http://azure.archive.ubuntu.com', 'https://archive.ubuntu.com')
function fixture(extra = {}) {
  const sources = new Map([
    ['/etc/apt/sources.list', legacy],
    ['/etc/apt/sources.list.d/ubuntu.sources', deb822],
  ])
  const writes = []
  const options = {
    platform: 'linux',
    architecture: 'x64',
    githubActions: 'true',
    osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\n',
    files: [...sources.keys()],
    readSource: async (file) => sources.get(file),
    writeSource: async (file, value) => {
      writes.push(file)
      sources.set(file, value)
    },
    install: async () => undefined,
    ...extra,
  }
  return { options, sources, writes }
}

describe('apt source rewrite', () => {
  test('rewrites only exact Azure Ubuntu archive URLs in active legacy and deb822 source lines', async () => {
    const { officialUbuntuSource } = await helper()
    const untouched = [
      '# deb http://azure.archive.ubuntu.com/ubuntu noble main',
      'URIs: http://security.ubuntu.com/ubuntu',
      'deb https://packages.microsoft.com/repos/code stable main',
      'URIs: https://azure.archive.ubuntu.com.evil/ubuntu',
      'URIs: http://azure.archive.ubuntu.com/ubuntuevil',
      'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
    ].join('\n')
    assert.equal(
      officialUbuntuSource(legacy + deb822 + untouched),
      official(legacy + deb822) + untouched
    )
  })

  test('restores every source after pinned browser dependency installation succeeds', async () => {
    const { provisionShareCardBrowsers } = await helper()
    const f = fixture()
    let installed = 0
    f.options.install = async () => {
      installed++
      assert.equal(f.sources.get(f.options.files[0]), official(legacy))
      assert.equal(f.sources.get(f.options.files[1]), official(deb822))
    }
    await provisionShareCardBrowsers(f.options)
    assert.equal(installed, 1)
    assert.equal(f.sources.get(f.options.files[0]), legacy)
    assert.equal(f.sources.get(f.options.files[1]), deb822)
  })

  test('install failure preserves its original error and restores sources', async () => {
    const { provisionShareCardBrowsers } = await helper()
    const original = new Error('stub_install_failed')
    const f = fixture({
      install: async () => {
        throw original
      },
    })
    await assert.rejects(
      provisionShareCardBrowsers(f.options),
      (error) => error === original
    )
    assert.deepEqual([...f.sources.values()], [legacy, deb822])
  })

  test('a partial mirror write failure restores both touched sources before returning', async () => {
    const { provisionShareCardBrowsers } = await helper()
    const f = fixture()
    const write = f.options.writeSource
    let failed = false
    f.options.writeSource = async (file, value) => {
      await write(file, value)
      if (!failed && file.endsWith('ubuntu.sources')) {
        failed = true
        throw new Error('stub_write_failed')
      }
    }
    await assert.rejects(provisionShareCardBrowsers(f.options), /stub_write_failed/)
    assert.deepEqual([...f.sources.values()], [legacy, deb822])
  })

  test('cleanup failure fails closed and retains an earlier install failure', async () => {
    const { provisionShareCardBrowsers } = await helper()
    const original = new Error('stub_install_failed')
    const f = fixture({
      install: async () => {
        throw original
      },
    })
    const write = f.options.writeSource
    f.options.writeSource = async (file, value) => {
      if (value === legacy) throw new Error('stub_restore_failed')
      await write(file, value)
    }
    await assert.rejects(provisionShareCardBrowsers(f.options), (error) => {
      assert.equal(error.message, 'browser_dependency_source_restore_failed')
      assert.ok(error.errors.includes(original))
      return true
    })
  })

  test('an already official mirror requires no source mutation', async () => {
    const { provisionShareCardBrowsers } = await helper()
    const f = fixture()
    for (const file of f.options.files) f.sources.set(file, official(f.sources.get(file)))
    await provisionShareCardBrowsers(f.options)
    assert.equal(f.writes.length, 0)
  })

  test('recognizes the exact hosted Ubuntu mirror-list URI and preserves other file sources', async () => {
    const { officialUbuntuSource } = await helper()
    // Runner image ubuntu24/20261012.334 configure-apt-sources.sh generates this URI.
    const uri = 'mirror+file:/etc/apt/apt-mirrors.txt'
    const source = `${legacy.replace('http://azure.archive.ubuntu.com/ubuntu', uri)}${deb822.replace('http://azure.archive.ubuntu.com/ubuntu/', uri)}`
    const untouched = [
      `# URIs: ${uri}`,
      `URIs: ${uri}.other`,
      `URIs: ${uri}/other`,
      'URIs: mirror+file:/tmp/apt-mirrors.txt',
      'URIs: https://security.ubuntu.com/ubuntu/',
    ].join('\n')
    assert.equal(
      officialUbuntuSource(source + untouched),
      source.replaceAll(uri, 'https://archive.ubuntu.com/ubuntu') + untouched
    )
  })

  test('provisions and restores hosted-image mirror-list sources with the original keyring and suites', async () => {
    const { provisionShareCardBrowsers } = await helper()
    const uri = 'mirror+file:/etc/apt/apt-mirrors.txt'
    const source = deb822.replace('http://azure.archive.ubuntu.com/ubuntu/', uri)
    const f = fixture()
    f.options.files = ['/etc/apt/sources.list.d/ubuntu.sources']
    f.sources.set(f.options.files[0], source)
    let installed = false
    f.options.install = async () => {
      installed = true
      assert.equal(
        f.sources.get(f.options.files[0]),
        source.replace(uri, 'https://archive.ubuntu.com/ubuntu')
      )
    }
    await provisionShareCardBrowsers(f.options)
    assert.equal(installed, true)
    assert.equal(f.sources.get(f.options.files[0]), source)
    assert.deepEqual(f.writes, [f.options.files[0], f.options.files[0]])
  })

  test('unexpected host, architecture or runner fails before reads, writes or install', async () => {
    const { provisionShareCardBrowsers } = await helper()
    for (const invalid of [
      { platform: 'darwin' },
      { architecture: 'arm64' },
      { githubActions: undefined },
      { osRelease: 'ID=debian\n' },
    ]) {
      let touched = false
      const touch = async () => {
        touched = true
      }
      const f = fixture({
        ...invalid,
        readSource: touch,
        writeSource: touch,
        install: touch,
      })
      await assert.rejects(
        provisionShareCardBrowsers(f.options),
        /owned_ubuntu_browser_runner_required/
      )
      assert.equal(touched, false)
    }
  })

  test('unrecognized archive configuration fails before any source mutation or installation', async () => {
    const { provisionShareCardBrowsers } = await helper()
    let installed = false
    const f = fixture({
      readSource: async () => 'URIs: https://unknown.invalid/ubuntu\n',
      install: async () => {
        installed = true
      },
    })
    await assert.rejects(
      provisionShareCardBrowsers(f.options),
      /official_ubuntu_archive_required/
    )
    assert.equal(f.writes.length, 0)
    assert.equal(installed, false)
  })
})

describe('pinned browser installer', () => {
  test('browser installer uses the pinned CLI and a GNU deadline with TERM, kill grace and outer bound', async () => {
    const { installPinnedPlaywrightBrowsers } = await helper()
    const calls = []
    installPinnedPlaywrightBrowsers({
      node: '/owned/node',
      cli: '/pinned/playwright/cli.js',
      run: (...args) => {
        calls.push(args)
        return { status: 0 }
      },
    })
    assert.deepEqual(calls, [
      [
        'timeout',
        [
          '--signal=TERM',
          '--kill-after=15s',
          '600s',
          '/owned/node',
          '/pinned/playwright/cli.js',
          'install',
          '--with-deps',
          'chromium',
          'firefox',
          'webkit',
        ],
        { stdio: 'inherit', timeout: 620000, killSignal: 'SIGKILL' },
      ],
    ])
  })

  test('API32 provisions only the Chromium engine required by the browser-mode accessibility bridge', async () => {
    const { installPinnedPlaywrightBrowsers } = await helper()
    let observed
    installPinnedPlaywrightBrowsers({
      node: '/owned/node',
      cli: '/pinned/cli.js',
      browsers: ['chromium'],
      run: (...args) => {
        observed = args
        return { status: 0 }
      },
    })
    assert.deepEqual(observed[1], [
      '--signal=TERM',
      '--kill-after=15s',
      '600s',
      '/owned/node',
      '/pinned/cli.js',
      'install',
      '--with-deps',
      'chromium',
    ])
  })

  test('the installer accepts only the two required engine sets', async () => {
    const { installPinnedPlaywrightBrowsers } = await helper()
    for (const browsers of [[], ['firefox'], ['chromium', 'firefox'], 'chromium']) {
      let called = false
      assert.throws(
        () =>
          installPinnedPlaywrightBrowsers({
            browsers,
            run: () => {
              called = true
              return { status: 0 }
            },
          }),
        /browser_dependency_engine_selection_required/
      )
      assert.equal(called, false)
    }
  })

  test('CLI engine selection is explicit and rejects unknown or duplicate arguments', async () => {
    const { shareCardBrowserEngines } = await helper()
    assert.deepEqual(shareCardBrowserEngines([]), ['chromium', 'firefox', 'webkit'])
    assert.deepEqual(shareCardBrowserEngines(['--chromium-only']), ['chromium'])
    for (const args of [['chromium'], ['--chromium-only', '--chromium-only']])
      assert.throws(
        () => shareCardBrowserEngines(args),
        /browser_dependency_engine_selection_required/
      )
  })

  test('missing deadline, timeout and installer failure all fail closed', async () => {
    const { installPinnedPlaywrightBrowsers } = await helper()
    for (const result of [
      { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) },
      { status: 124 },
      { status: 137 },
      { status: 7 },
    ]) {
      assert.throws(
        () =>
          installPinnedPlaywrightBrowsers({
            node: '/owned/node',
            cli: '/pinned/cli.js',
            run: () => result,
          }),
        /browser_dependency_(deadline_required|install_timeout|install_failed)/
      )
    }
  })
})

describe('browser dependency workflow', () => {
  const read = async () =>
    parse(
      await readFile(
        new URL('../../.github/workflows/pr-share-card-native.yml', import.meta.url),
        'utf8'
      )
    )
  const provisioningOf = (steps) =>
    steps.filter((step) =>
      step.run?.includes('node scripts/ci/share-card-browser-deps.mjs')
    )
  const bridge = (steps) =>
    steps.findIndex((item) =>
      item.run?.includes('node scripts/e2e-share-card/bridge-a11y.mjs')
    )
  const assertBounded = (step) => {
    assert.equal(step['timeout-minutes'], 12)
    assert.equal(step['continue-on-error'], undefined)
    assert.equal(
      runGatesTestFile(step.run, 'scripts/ci/share-card-browser-deps.test.mjs'),
      true
    )
    assert.ok(
      step.run.indexOf('node scripts/ci/node-test-gate.mjs browser-deps') >= 0 &&
        step.run.indexOf('node scripts/ci/node-test-gate.mjs browser-deps') <
          step.run.indexOf('node scripts/ci/share-card-browser-deps.mjs')
    )
  }

  test('every browser-mode mobile bridge has bounded pinned Chromium provisioning', async () => {
    const workflow = await read()
    const jobs = [
      'original-resource',
      'android36-native-matrix',
      'android36-original',
      'android36-controls',
      'android36-interaction',
    ]
    for (const name of jobs) {
      const steps = workflow.jobs[name].steps
      const provisioning = provisioningOf(steps)
      assert.equal(provisioning.length, 1, name)
      const step = provisioning[0]
      assertBounded(step)
      assert.equal(
        step.run
          .split('\n')
          .some((line) => line.trim() === 'node scripts/ci/share-card-browser-deps.mjs'),
        false,
        `${name}: native bridge needs Chromium only`
      )
      assert.ok(
        step.run.includes('node scripts/ci/share-card-browser-deps.mjs --chromium-only'),
        name
      )
      assert.equal(
        steps.some((item) => item.run?.includes('npx playwright install --with-deps')),
        false,
        name
      )
      assert.ok(steps.indexOf(step) < bridge(steps), name)
      assert.ok(bridge(steps) >= 0, name)
      assert.equal(
        steps.some(
          (item) => item.name === 'Genuine browser share-card acceptance matrix'
        ),
        false,
        `${name}: the browser matrix belongs to browser-acceptance`
      )
    }
    const original = workflow.jobs['original-resource'].steps
    assert.equal(provisioningOf(original)[0].if, "matrix.platform == 'android'")
    const iosSteps = workflow.jobs['ios-build'].steps
    const mac = iosSteps.find((item) =>
      item.run?.includes('npx --no-install playwright install chromium')
    )
    assert.ok(mac)
    assert.equal(mac.if, undefined)
    assert.equal(mac['timeout-minutes'], 6)
    assert.equal(mac['continue-on-error'], undefined)
    assert.ok(iosSteps.indexOf(mac) < bridge(iosSteps))
  })

  test('the independent browser acceptance job retains all three pinned engines before the matrix', async () => {
    const steps = (await read()).jobs['browser-acceptance'].steps
    const provisioning = provisioningOf(steps)
    assert.equal(provisioning.length, 1)
    const step = provisioning[0]
    assertBounded(step)
    assert.ok(
      step.run
        .split('\n')
        .some((line) => line.trim() === 'node scripts/ci/share-card-browser-deps.mjs')
    )
    assert.equal(step.run.includes('--chromium-only'), false)
    assert.equal(
      steps.some((item) => item.run?.includes('npx playwright install --with-deps')),
      false
    )
    assert.ok(
      steps.indexOf(step) <
        steps.findIndex(
          (item) => item.name === 'Genuine browser share-card acceptance matrix'
        )
    )
    assert.equal(bridge(steps), -1)
  })
})
