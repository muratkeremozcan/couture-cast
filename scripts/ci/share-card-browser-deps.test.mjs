import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'

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
test('mandatory API36 browser provisioning is separately bounded and common bridge does not reinstall browsers', async () => {
  const workflow = parse(
    await readFile(
      new URL('../../.github/workflows/pr-share-card-native.yml', import.meta.url),
      'utf8'
    )
  )
  const steps = workflow.jobs['original-resource'].steps
  const provisioning = steps.filter((step) =>
    step.run?.split('\n').includes('node scripts/ci/share-card-browser-deps.mjs')
  )
  assert.equal(provisioning.length, 1)
  const step = provisioning[0]
  assert.equal(step.if, "matrix.platform == 'android' && matrix.api == 36")
  assert.equal(step['timeout-minutes'], 12)
  assert.equal(step['continue-on-error'], undefined)
  const controls = step.run.indexOf(
    'node --test scripts/ci/share-card-browser-deps.test.mjs'
  )
  assert.ok(
    controls >= 0 &&
      controls < step.run.indexOf('node scripts/ci/share-card-browser-deps.mjs')
  )
  assert.equal(
    steps.some((item) => item.run?.includes('npx playwright install --with-deps')),
    false
  )
  assert.ok(
    steps.findIndex((item) => item === step) <
      steps.findIndex(
        (item) => item.name === 'Genuine browser share-card acceptance matrix'
      )
  )
  assert.ok(
    steps.some((item) =>
      item.run?.includes('node scripts/e2e-share-card/bridge-a11y.mjs')
    )
  )
})
