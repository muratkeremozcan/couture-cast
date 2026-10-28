import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const helper = () => import('./share-card-native-diagnostics.mjs')
const personal =
  'Private Person person@private.invalid 123456 eyJhbGciOiJIUzI1NiJ9.private.signature access_token=secret 367fea4a-e1da-456e-a355-1bcc7f9da4f3'
const command = (name, id, status = 'FAILED', sequenceNumber = 3, depth = 1) => ({
  command: { [name]: { selector: { idRegex: id } } },
  metadata: { status, sequenceNumber, depth, duration: 30000 },
})
const context = {
  flow: 'maestro/story68/open-outfit.yaml',
  platform: 'android',
  durationMs: 41674,
  exitCode: 1,
  signal: null,
}
const hierarchy = {
  attributes: { bounds: '[0,0][1080,2400]' },
  children: [
    {
      attributes: {
        'resource-id': 'tab-home',
        bounds: '[10,2300][200,2390]',
        text: 'Home',
      },
    },
    {
      attributes: {
        'resource-id': 'share-card-title',
        bounds: '[10,100][1000,200]',
        text: 'Your share card',
      },
    },
    {
      attributes: {
        'resource-id': 'private-name',
        bounds: '[10,210][1000,300]',
        text: personal,
      },
    },
  ],
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-diagnostic-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function invokeMaestro(t, capture) {
  const directory = fixture(t)
  const source = fs.readFileSync(
    path.join(root, 'scripts/run-story68-native.mjs'),
    'utf8'
  )
  const start = source.indexOf('function maestro('),
    end = source.indexOf('async function signin()', start)
  let tick = 100000
  const context = {
    requireDevice: () => undefined,
    Date: { now: () => (tick += 100) },
    directory,
    path,
    fs,
    root,
    platform: 'android',
    device: 'emulator-5554',
    adb: '/owned/adb',
    maestroBinary: '/unused/maestro',
    DRIVER_HOST_PORT_ARG: '--port',
    MAESTRO_ANDROID_DRIVER_PORT: 17001,
    process: { env: {}, kill: () => assert.fail('unexpected process mutation') },
    withNativeTransport: (work) => work(),
    reverse: () => undefined,
    localeEnv: () => ({}),
    spawnSync: () => ({
      status: 1,
      stdout: 'maestro.MaestroException$ElementNotFound',
      stderr: '',
    }),
    shouldRetryIosSnapshot: () => false,
    flowTimeoutMs: () => 120_000,
    privateJson: () => undefined,
    summarizeNativeFlowFailure: () => ({}),
    recordNativeFlowDiagnostics: capture,
  }
  return vm.runInNewContext(`(${source.slice(start, end)})`, context)
}

describe('native flow diagnostics projection', () => {
  test('deepest last failed Maestro command retains exact known selector/status without environment or input values', async () => {
    const { projectNativeFlowDiagnostics } = await helper()
    const result = projectNativeFlowDiagnostics({
      ...context,
      root,
      commands: [
        {
          command: { defineVariablesCommand: { env: { MAESTRO_OTP: personal } } },
          metadata: { status: 'COMPLETED', sequenceNumber: 0, depth: 0 },
        },
        command('runFlowCommand', personal, 'FAILED', 1, 0),
        command('tapOnElement', 'tab-home', 'FAILED', 2, 1),
        command('scrollUntilVisible', 'outfit-share-card-open', 'FAILED', 3, 2),
      ],
      hierarchy,
      log: `maestro.MaestroException$ElementNotFound: Element not found ${personal}`,
      screenshot: { width: 1080, height: 2400, source: 'maestro-failed-step' },
    })
    assert.deepEqual(result.failedCommand.selector, {
      kind: 'id',
      value: 'outfit-share-card-open',
    })
    assert.equal(result.failedCommand.status, 'FAILED')
    assert.equal(result.failedCommand.name, 'scrollUntilVisible')
    assert.equal(result.classification, 'elementtimeout')
    assert.equal(result.screen.controls.length, 2)
    assert.ok(result.screen.labels.includes('Your share card'))
    for (const secret of personal.split(' '))
      assert.equal(JSON.stringify(result).includes(secret), false)
  })

  test('dynamic fixture selectors become fixed templates and arbitrary text selectors remain unavailable', async () => {
    const { projectNativeFlowDiagnostics } = await helper()
    for (const [id, expected] of [
      [
        'community-share-card-open-367fea4a-e1da-456e-a355-1bcc7f9da4f3',
        'community-share-card-open-{fixture}',
      ],
      [
        'share-card-preview-loaded-' + 'a'.repeat(64),
        'share-card-preview-loaded-{digest}',
      ],
      [personal, 'unavailable'],
    ]) {
      const result = projectNativeFlowDiagnostics({
        ...context,
        root,
        commands: [command('tapOnElement', id)],
      })
      assert.equal(result.failedCommand.selector.value, expected)
    }
  })

  test('logcat and system inputs expose only known signatures and bounded numeric resource facts', async () => {
    const { projectNativeFlowDiagnostics } = await helper()
    const result = projectNativeFlowDiagnostics({
      ...context,
      root,
      commands: [],
      log: personal,
      logcat: `${personal}\nANR in com.couturecast.story68\nFATAL EXCEPTION: main\nConfigured linking in multiple places`,
      system: {
        boot: '1\r\n',
        uptime: '41.75 20.01',
        meminfo: `MemTotal: 4000000 kB\nMemAvailable: 812000 kB\n${personal}`,
        memoryPressure:
          'some avg10=66.98 avg60=1 avg300=0 total=1\nfull avg10=19.78 avg60=1 avg300=0 total=1',
      },
    })
    assert.equal(result.resources.bootCompleted, true)
    assert.equal(result.resources.uptimeSeconds, 41.75)
    assert.equal(result.resources.memAvailableKB, 812000)
    assert.equal(result.resources.memoryPressureSome10, 66.98)
    assert.ok(result.signatures.includes('android-anr'))
    assert.ok(result.signatures.includes('react-native-duplicate-linking'))
    assert.equal(JSON.stringify(result).includes('private.invalid'), false)
  })

  test('diagnostic schema rejects poisoned selectors, labels, bounds, extra fields and unsupported raw fragments', async () => {
    const { projectNativeFlowDiagnostics, assertNativeFlowDiagnostics } = await helper()
    const clean = projectNativeFlowDiagnostics({
      ...context,
      root,
      commands: [],
      hierarchy,
    })
    for (const mutate of [
      (v) => (v.rawLog = personal),
      (v) => v.screen.labels.push(personal),
      (v) => (v.screen.controls[0].id = personal),
      (v) => (v.resources.memAvailableKB = personal),
      (v) => (v.screen.width = 1e12),
      (v) => (v.failedCommand = { secret: personal }),
    ]) {
      const value = structuredClone(clean)
      mutate(value)
      assert.throws(() => assertNativeFlowDiagnostics(value, { root }), {
        message: 'invalid_native_flow_diagnostics',
      })
    }
  })

  test('Home scroll and weather header selectors stay named in the public command record', async () => {
    const { projectNativeFlowDiagnostics } = await helper()
    for (const id of [
      'hero-experience-scrollview',
      'weather-header',
      'weather-header-skeleton',
    ])
      assert.deepEqual(
        projectNativeFlowDiagnostics({
          ...context,
          root,
          commands: [command('scrollUntilVisible', id)],
          hierarchy,
        }).failedCommand.selector,
        { kind: 'id', value: id }
      )
  })
  test('a failed flow reports Maestro scroll, tap and settle facts plus the closed dialog trace', async () => {
    const { projectNativeFlowDiagnostics, assertNativeFlowDiagnostics } = await helper()
    const log = [
      '15:35:55.545 [ INFO] maestro.orchestra.Orchestra.scrollUntilVisible: Scrolling try count: 0, DeviceWidth: 1080, DeviceWidth: 2400',
      '15:35:55.545 [ INFO] maestro.orchestra.Orchestra.scrollUntilVisible: Element bounds: Bounds(x=42, y=1331, width=996, height=126)',
      `15:35:56.584 [ INFO] maestro.Maestro.hierarchyBasedTap-ogj28Uc: Tapping at (540, 1394) using hierarchy based logic for wait ${personal}`,
      '15:35:59.603 [ INFO] maestro.Maestro.hierarchyBasedTap-ogj28Uc: Something has changed in the UI judging by view hierarchy. Proceed.',
      '15:36:00.100 [ INFO] maestro.Maestro.hierarchyBasedTap-ogj28Uc: Nothing changed in the UI.',
    ].join('\n')
    const logcat = [
      '10-27 15:35:57.000  8565  8601 I ReactNativeJS: [cc68-presentation] open',
      '10-27 15:35:57.100  8565  8601 I ReactNativeJS: [cc68-presentation] render',
      `10-27 15:35:57.200  8565  8601 I ReactNativeJS: [cc68-presentation] retire ${personal}`,
      '10-27 15:35:57.300  8565  8601 I ReactNativeJS: [cc68-presentation] invented',
    ].join('\n')
    const result = projectNativeFlowDiagnostics({
      ...context,
      root,
      commands: [command('tapOnElement', 'outfit-share-card-open')],
      hierarchy,
      log,
      logcat,
    })
    assert.deepEqual(result.interactions, [
      { kind: 'scroll', attempt: 0, element: [0.038889, 0.554583, 0.922222, 0.0525] },
      { kind: 'tap', point: [0.5, 0.580833] },
      { kind: 'settle', changed: true },
      { kind: 'settle', changed: false },
    ])
    assert.deepEqual(result.presentationTrace, ['open', 'render', 'retire'])
    assert.equal(JSON.stringify(result).includes('Private Person'), false)
    for (const poison of [
      { ...result, interactions: [{ kind: 'tap', point: [2, 0.5] }] },
      { ...result, interactions: [{ kind: 'note', text: 'private' }] },
      { ...result, presentationTrace: ['open', 'private'] },
    ])
      assert.throws(() => assertNativeFlowDiagnostics(poison, { root }), {
        message: 'invalid_native_flow_diagnostics',
      })
  })
})

describe('native flow diagnostics capture', () => {
  test('failed capture finds nested logs and paired deepest-command artifacts, collects read-only facts before device teardown', async (t) => {
    const { collectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t)
    const output = path.join(directory, 'maestro-current')
    const flowDir = path.join(output, 'open-outfit')
    fs.mkdirSync(path.join(flowDir, 'screen-hierarchy'), { recursive: true })
    fs.mkdirSync(path.join(flowDir, 'screenshots'))
    const sharp = (await import('sharp')).default
    await sharp({
      create: { width: 1080, height: 2400, channels: 3, background: '#ff0000' },
    })
      .png()
      .toFile(path.join(flowDir, 'screenshots/failure.png'))
    fs.writeFileSync(
      path.join(flowDir, 'screen-hierarchy/failure.json'),
      JSON.stringify(hierarchy)
    )
    const failed = command('scrollUntilVisible', 'outfit-share-card-open')
    failed.metadata.artifacts = [
      { type: 'SCREENSHOT', path: 'screenshots/failure.png' },
      { type: 'SCREEN_HIERARCHY', path: 'screen-hierarchy/failure.json' },
    ]
    fs.writeFileSync(path.join(flowDir, 'commands.json'), JSON.stringify([failed]))
    fs.mkdirSync(path.join(flowDir, 'logs'))
    fs.writeFileSync(
      path.join(flowDir, 'logs/maestro.log'),
      `Element not found ${personal}`
    )
    const calls = []
    const result = await collectNativeFlowDiagnostics(
      {
        ...context,
        root,
        directory,
        output,
        device: 'emulator-5554',
        adb: '/owned/adb',
        startedAt: Date.now() - 45000,
      },
      {
        execute: (binary, args, options) => {
          calls.push({ binary, args, options })
          return {
            status: 0,
            stdout: args.includes('logcat')
              ? personal
              : args.includes('meminfo')
                ? 'MemAvailable: 812000 kB'
                : '1',
          }
        },
      }
    )
    assert.equal(result.failedCommand.selector.value, 'outfit-share-card-open')
    assert.equal(result.screen.source, 'maestro-failed-step')
    assert.equal(result.captures.hierarchy, true)
    assert.equal(result.captures.commands, true)
    assert.ok(calls.some(({ args }) => args.includes('logcat')))
    assert.ok(
      calls.every(({ options }) => options.timeout > 0 && options.timeout <= 1500)
    )
    assert.ok(
      calls.every(
        ({ args }) =>
          !args.some((arg) => /force-stop|install|input|uiautomator/.test(arg))
      )
    )
    const outputText = fs.readFileSync(
      path.join(directory, 'native-flow-diagnostics-android.json'),
      'utf8'
    )
    assert.equal(outputText.includes('private.invalid'), false)
  })

  test('actual maestro failure hook captures before secret artifact deletion and retains the original flow error', (t) => {
    // maestro() swallows capture errors by design, so the callback only records what it
    // saw and the assertions run after the flow error surfaces.
    const calls = []
    const maestro = invokeMaestro(t, (input) => {
      calls.push({
        output: input.output,
        outputExisted: fs.existsSync(input.output),
        sensitive: input.sensitive,
      })
    })
    assert.throws(
      () => maestro('maestro/story68/open-outfit.yaml', {}, personal),
      /native_flow_failed:maestro\/story68\/open-outfit.yaml/
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].outputExisted, true)
    assert.equal(calls[0].sensitive, true)
    assert.equal(fs.existsSync(calls[0].output), false)
  })

  test('a diagnostic infrastructure failure never replaces the original Maestro assertion', (t) => {
    const maestro = invokeMaestro(t, () => {
      throw new Error('capture broke')
    })
    assert.throws(
      () => maestro('maestro/story68/open-outfit.yaml'),
      /native_flow_failed:maestro\/story68\/open-outfit.yaml/
    )
  })

  test('sensitive sign-in failure exports command structure while withholding screenshots, labels and raw logcat files', async (t) => {
    const { collectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t),
      output = path.join(directory, 'maestro-sensitive')
    fs.mkdirSync(output)
    fs.writeFileSync(
      path.join(output, 'commands.json'),
      JSON.stringify([
        {
          command: { inputTextCommand: { text: personal } },
          metadata: { status: 'FAILED', sequenceNumber: 1, depth: 0, artifacts: [] },
        },
      ])
    )
    const result = await collectNativeFlowDiagnostics(
      {
        ...context,
        root,
        directory,
        output,
        device: 'emulator-5554',
        adb: '/fake/adb',
        sensitive: true,
        log: personal,
      },
      { execute: () => ({ status: 0, stdout: personal }) }
    )
    assert.equal(result.failedCommand.name, 'inputTextCommand')
    assert.equal(result.screen.source, 'unavailable')
    assert.deepEqual(result.screen.labels, [])
    assert.deepEqual(fs.readdirSync(path.join(output, 'failure-private')), [])
    assert.equal(JSON.stringify(result).includes('private.invalid'), false)
  })

  test('escaped and symlinked failed-step artifacts are refused with truthful unavailable capture status', async (t) => {
    const { collectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t),
      output = path.join(directory, 'maestro-boundary')
    fs.mkdirSync(output)
    const outside = path.join(directory, 'outside.json')
    fs.writeFileSync(outside, JSON.stringify(hierarchy))
    fs.symlinkSync(outside, path.join(output, 'linked.json'))
    const row = command('tapOnElement', 'tab-home')
    row.metadata.artifacts = [
      { type: 'SCREEN_HIERARCHY', path: '../outside.json' },
      { type: 'SCREEN_HIERARCHY', path: outside },
      { type: 'SCREEN_HIERARCHY', path: 'linked.json' },
    ]
    fs.writeFileSync(path.join(output, 'commands.json'), JSON.stringify([row]))
    const result = await collectNativeFlowDiagnostics(
      { ...context, root, directory, output, device: 'emulator-5554', adb: '/fake/adb' },
      { execute: () => ({ status: 1, stdout: '' }) }
    )
    assert.equal(result.captures.hierarchy, false)
    assert.equal(result.captures.screenshot, false)
    assert.equal(result.captures.system, false)
    assert.equal(result.failedCommand.selector.value, 'tab-home')
  })

  test('a killed retry keeps the captured FAILED attempt over its deeper artifact-free RUNNING row', async (t) => {
    const { collectNativeFlowDiagnostics, projectNativeFlowDiagnostics } = await helper()
    const captured = command('tapOnElement', 'tab-home', 'FAILED', 4, 1)
    captured.metadata.artifacts = [
      { type: 'SCREEN_HIERARCHY', path: 'screen-hierarchy/attempt-1.json' },
    ]
    const running = command(
      'scrollUntilVisible',
      'outfit-share-card-open',
      'RUNNING',
      9,
      2
    )
    const rows = [captured, running]
    assert.equal(
      projectNativeFlowDiagnostics({ ...context, root, commands: rows, hierarchy })
        .failedCommand.selector.value,
      'tab-home'
    )
    // Without a captured hierarchy the deepest row still wins, as before.
    assert.equal(
      projectNativeFlowDiagnostics({
        ...context,
        root,
        commands: [command('tapOnElement', 'tab-home', 'FAILED', 4, 1), running],
        hierarchy,
      }).failedCommand.selector.value,
      'outfit-share-card-open'
    )
    const directory = fixture(t)
    const output = path.join(directory, 'maestro-current')
    const flowDir = path.join(output, 'open-app')
    fs.mkdirSync(path.join(flowDir, 'screen-hierarchy'), { recursive: true })
    fs.writeFileSync(
      path.join(flowDir, 'screen-hierarchy/attempt-1.json'),
      JSON.stringify(hierarchy)
    )
    fs.writeFileSync(path.join(flowDir, 'commands.json'), JSON.stringify(rows))
    const result = await collectNativeFlowDiagnostics(
      {
        ...context,
        flow: 'maestro/story65/open-app.yaml',
        root,
        directory,
        output,
        device: 'emulator-5554',
        adb: '/owned/adb',
        startedAt: Date.now() - 125000,
      },
      { execute: () => ({ status: 1, stdout: '' }) }
    )
    assert.equal(result.failedCommand.status, 'FAILED')
    assert.equal(result.failedCommand.selector.value, 'tab-home')
    assert.equal(result.captures.hierarchy, true)
    assert.equal(result.screen.controls.length, 2)
  })
  for (const separate of [false, true]) {
    for (const scenario of ['captured-running', 'missing-running', 'captured-failed']) {
      test(`${scenario} ranks actual captures across ${separate ? 'separate-commands.json files' : 'one commands.json file'}`, async (t) => {
        const { collectNativeFlowDiagnostics } = await helper()
        const directory = fixture(t)
        const output = path.join(directory, 'maestro-current')
        const first = path.join(output, 'a-first')
        const second = separate ? path.join(output, 'z-second') : first
        fs.mkdirSync(first, { recursive: true })
        fs.mkdirSync(second, { recursive: true })
        const shallow = command('tapOnElement', 'tab-home', 'FAILED', 4, 1)
        shallow.metadata.artifacts = [{ type: 'SCREEN_HIERARCHY', path: 'capture.json' }]
        if (scenario !== 'missing-running')
          fs.writeFileSync(path.join(first, 'capture.json'), JSON.stringify(hierarchy))
        const deeper = command(
          'scrollUntilVisible',
          'outfit-share-card-open',
          scenario === 'captured-failed' ? 'FAILED' : 'RUNNING',
          9,
          2
        )
        fs.writeFileSync(
          path.join(first, 'commands.json'),
          JSON.stringify(separate ? [shallow] : [shallow, deeper])
        )
        if (separate)
          fs.writeFileSync(path.join(second, 'commands.json'), JSON.stringify([deeper]))
        const result = await collectNativeFlowDiagnostics(
          {
            ...context,
            root,
            directory,
            output,
            device: 'emulator-5554',
            adb: '/owned/adb',
            startedAt: Date.now(),
          },
          { execute: () => ({ status: 1, stdout: '' }) }
        )
        assert.equal(
          result.failedCommand.selector.value,
          scenario === 'captured-running' ? 'tab-home' : 'outfit-share-card-open'
        )
        assert.equal(result.captures.hierarchy, scenario === 'captured-running')
      })
    }
  }

  test('missing command output preserves unavailable step instead of inventing a failed selector', async (t) => {
    const { collectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t),
      output = path.join(directory, 'maestro-no-commands')
    fs.mkdirSync(output)
    const result = await collectNativeFlowDiagnostics(
      { ...context, root, directory, output, device: 'emulator-5554', adb: '/fake/adb' },
      { execute: () => ({ status: 1, stdout: '' }) }
    )
    assert.equal(result.failedCommand, null)
    assert.equal(result.captures.commands, false)
    assert.equal(result.screen.source, 'unavailable')
  })
})

describe('native flow public evidence', () => {
  test('public projection generates a fully masked labelled derivative and never copies a forged raw screenshot', async (t) => {
    const { projectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t)
    const summary = projectNativeFlowDiagnostics({
      ...context,
      root,
      commands: [command('tapOnElement', 'tab-home')],
      hierarchy,
      screenshot: { width: 1080, height: 2400, source: 'maestro-failed-step' },
    })
    fs.writeFileSync(
      path.join(directory, 'native-flow-diagnostics-android.json'),
      JSON.stringify(summary)
    )
    const sharp = (await import('sharp')).default
    // A decodable solid-red forgery carrying private bytes: a copied claim would surface
    // as red pixels and as the private text in the published file.
    const forged = await sharp({
      create: { width: 1080, height: 2400, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer()
    fs.writeFileSync(
      path.join(directory, 'native-flow-diagnostics-android-redacted.png'),
      Buffer.concat([forged, Buffer.from(personal)])
    )
    const result = spawnSync(
      process.execPath,
      ['scripts/e2e-share-card/public-evidence.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CC68_HARNESS_DIR: directory },
      }
    )
    assert.equal(result.status, 0, result.stderr)
    const image = fs.readFileSync(
      path.join(directory, 'public-evidence/native-flow-diagnostics-android-redacted.png')
    )
    assert.equal((await sharp(image).metadata()).width, 1080)
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
    let red = 0
    for (let offset = 0; offset < data.length; offset += info.channels)
      if (data[offset] === 255 && data[offset + 1] === 0 && data[offset + 2] === 0) red++
    assert.equal(red, 0)
    assert.equal(image.includes(Buffer.from('private.invalid')), false)
  })

  test('public projection validates all diagnostics before copying any pre-existing proof', async (t) => {
    const { projectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t)
    const summary = projectNativeFlowDiagnostics({ ...context, root, commands: [] })
    summary.screen.labels.push(personal)
    fs.writeFileSync(
      path.join(directory, 'native-flow-diagnostics-android.json'),
      JSON.stringify(summary)
    )
    fs.writeFileSync(path.join(directory, 'accessibility-bridge.json'), '{}')
    const result = spawnSync(
      process.execPath,
      ['scripts/e2e-share-card/public-evidence.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CC68_HARNESS_DIR: directory },
      }
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Error: invalid_native_flow_diagnostics\b/)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
    assert.equal(result.stderr.includes('private.invalid'), false)
  })

  test('browser watermark failure and success summaries survive public projection with only closed fields', async (t) => {
    const { browserWatermarkChecks } = await import('./story68-browser-watermark.mjs')
    const directory = fixture(t)
    const failure = {
      version: 1,
      browser: 'webkit',
      passed: false,
      code: 'browser_watermark_check_failed',
      phase: 'blocked',
      elapsedMs: 2005.5933,
      heldMs: 2005.5933,
      requests: 1,
      unavailableResponses: 0,
      checks: Object.fromEntries(browserWatermarkChecks.map((key) => [key, false])),
    }
    fs.writeFileSync(
      path.join(directory, 'browser-watermark-webkit.json'),
      JSON.stringify({ ...failure, privateLog: personal })
    )
    const run = () =>
      spawnSync(process.execPath, ['scripts/e2e-share-card/public-evidence.mjs'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CC68_HARNESS_DIR: directory },
      })
    assert.equal(run().status, 0)
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'public-evidence/browser-watermark-webkit.json')
        )
      ),
      failure
    )
    const success = {
      ...failure,
      passed: true,
      code: 'ok',
      phase: 'complete',
      requests: 3,
      heldMs: 5000,
      elapsedMs: 5500,
      checks: Object.fromEntries(browserWatermarkChecks.map((key) => [key, true])),
    }
    fs.writeFileSync(
      path.join(directory, 'browser-watermark-webkit.json'),
      JSON.stringify(success)
    )
    assert.equal(run().status, 0)
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'public-evidence/browser-watermark-webkit.json')
        )
      ),
      success
    )
  })

  test('browser summary poisoning and filename mismatch fail before any artifact is copied', async (t) => {
    const { browserWatermarkChecks } = await import('./story68-browser-watermark.mjs')
    const directory = fixture(t)
    // A schema-valid record that would otherwise publish, so only the browser summary refuses.
    fs.writeFileSync(
      path.join(directory, 'accessibility-bridge.json'),
      JSON.stringify({
        method:
          'React Native posted accessibility announcement and intended focus bridge unit assertions',
        passed: true,
        cases: [{ locale: 'en-US', state: 'saved', passed: true }],
        runner: {
          classification: 'passed',
          exitCode: 0,
          reportPresent: true,
          reportSuccessful: true,
          assertionsObserved: 1,
          assertionsFailed: 0,
          matchedCases: 1,
          requiredCases: 1,
        },
      })
    )
    const value = {
      version: 1,
      browser: 'webkit',
      passed: false,
      code: 'browser_watermark_check_failed',
      phase: 'blocked',
      elapsedMs: 2005,
      heldMs: 2005,
      requests: 1,
      unavailableResponses: 0,
      checks: Object.fromEntries(browserWatermarkChecks.map((key) => [key, false])),
    }
    for (const patch of [
      { code: personal },
      { phase: personal },
      { browser: 'chromium' },
      { elapsedMs: personal },
      { checks: { ...value.checks, rolledBack: personal } },
    ]) {
      fs.writeFileSync(
        path.join(directory, 'browser-watermark-webkit.json'),
        JSON.stringify({ ...value, ...patch })
      )
      const result = spawnSync(
        process.execPath,
        ['scripts/e2e-share-card/public-evidence.mjs'],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, CC68_HARNESS_DIR: directory },
        }
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Error: invalid_browser_watermark_evidence\b/)
      assert.equal(result.stderr.includes('private.invalid'), false)
      assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
    }
  })

  test('public diagnostics platform mismatch clears stale generated evidence and fails before any copy', async (t) => {
    const { projectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t)
    fs.mkdirSync(path.join(directory, 'public-evidence'))
    fs.writeFileSync(path.join(directory, 'public-evidence/stale-private.log'), personal)
    fs.writeFileSync(
      path.join(directory, 'native-flow-diagnostics-ios.json'),
      JSON.stringify(projectNativeFlowDiagnostics({ ...context, root, commands: [] }))
    )
    const result = spawnSync(
      process.execPath,
      ['scripts/e2e-share-card/public-evidence.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CC68_HARNESS_DIR: directory },
      }
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Error: invalid_native_flow_diagnostics\b/)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
    assert.equal(result.stderr.includes('private.invalid'), false)
  })

  test('a retained first browser failure remains public alongside a later success and rejects forged successful failure files', async (t) => {
    const { browserWatermarkChecks } = await import('./story68-browser-watermark.mjs')
    const directory = fixture(t)
    const failure = {
      version: 1,
      browser: 'webkit',
      passed: false,
      code: 'browser_watermark_check_failed',
      phase: 'blocked',
      elapsedMs: 2005,
      heldMs: 2005,
      requests: 1,
      unavailableResponses: 0,
      checks: Object.fromEntries(browserWatermarkChecks.map((key) => [key, false])),
    }
    const success = {
      ...failure,
      passed: true,
      code: 'ok',
      phase: 'complete',
      requests: 3,
      checks: Object.fromEntries(browserWatermarkChecks.map((key) => [key, true])),
    }
    fs.writeFileSync(
      path.join(directory, 'browser-watermark-failure-webkit.json'),
      JSON.stringify(failure)
    )
    fs.writeFileSync(
      path.join(directory, 'browser-watermark-webkit.json'),
      JSON.stringify(success)
    )
    const run = () =>
      spawnSync(process.execPath, ['scripts/e2e-share-card/public-evidence.mjs'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CC68_HARNESS_DIR: directory },
      })
    assert.equal(run().status, 0)
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'public-evidence/browser-watermark-failure-webkit.json')
        )
      ).passed,
      false
    )
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, 'public-evidence/browser-watermark-webkit.json')
        )
      ).passed,
      true
    )
    fs.writeFileSync(
      path.join(directory, 'browser-watermark-failure-webkit.json'),
      JSON.stringify(success)
    )
    const forged = run()
    assert.notEqual(forged.status, 0)
    assert.match(forged.stderr, /Error: invalid_browser_watermark_evidence\b/)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
  })
  test('a refusal after earlier files rendered publishes nothing, not a partial set', async (t) => {
    const { projectNativeFlowDiagnostics } = await helper()
    const directory = fixture(t)
    // The diagnostics JSON and its redacted render are produced before the proof loop
    // reaches the poisoned original-proof projection.
    fs.writeFileSync(
      path.join(directory, 'native-flow-diagnostics-android.json'),
      JSON.stringify(
        projectNativeFlowDiagnostics({
          ...context,
          root,
          commands: [command('tapOnElement', 'tab-home')],
          hierarchy,
          screenshot: { width: 1080, height: 2400, source: 'maestro-failed-step' },
        })
      )
    )
    fs.writeFileSync(
      path.join(directory, 'original-proof-android.json'),
      JSON.stringify({
        sha256: 'a'.repeat(64),
        bytes: 1,
        chunks: ['access_token=leaked'],
      })
    )
    const result = spawnSync(
      process.execPath,
      ['scripts/e2e-share-card/public-evidence.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CC68_HARNESS_DIR: directory },
      }
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Error: private_data_in_public_evidence\b/)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'public-evidence')), [])
    assert.equal(fs.existsSync(path.join(directory, '.public-evidence-staging')), false)
  })
})

describe('native flow diagnostics CI registration', () => {
  // Registration is part of the capture contract: both native lanes inherit this step.
  test('mandatory native CI executes diagnostic boundary controls before native generation and rejects registration removal', async () => {
    const { parse } = await import('yaml')
    const { coverageProblems, loadManifest, runGatesTestFile } = await import(
      '../ci/node-test-gate.mjs'
    )
    const workflow = fs.readFileSync(
      path.join(root, '.github/workflows/pr-share-card-native.yml'),
      'utf8'
    )
    const steps = parse(workflow).jobs['original-resource'].steps
    const required = 'scripts/lib/share-card-native-diagnostics.test.mjs'
    const registered = (manifest) =>
      steps.findIndex((step) => runGatesTestFile(step.run, required, { root, manifest }))
    const controls = registered(loadManifest(root))
    assert.ok(controls >= 0)
    assert.ok(
      controls <
        steps.findIndex((step) => step.name === 'Generate native development client')
    )
    // Moving the file into a suite no step runs drops it from the step and fails coverage.
    const moved = loadManifest(root)
    moved.suites.unscheduled = [required]
    assert.equal(registered(moved), -1)
    assert.ok(
      coverageProblems({ root, manifest: moved, workflow }).includes(
        'suite unscheduled runs in no workflow step'
      )
    )
  })
})

describe('global failure ranking across all command files', () => {
  const reviewerOrders = [
    ['captured', 'failed', 'running'],
    ['captured', 'running', 'failed'],
    ['failed', 'captured', 'running'],
    ['failed', 'running', 'captured'],
    ['running', 'captured', 'failed'],
    ['running', 'failed', 'captured'],
  ]
  for (const separate of [false, true]) {
    for (const order of reviewerOrders) {
      test(`three-way ranking ${separate ? 'files' : 'rows'} ${order.join(',')}`, async (t) => {
        const { collectNativeFlowDiagnostics } = await helper()
        const directory = fixture(t)
        const output = path.join(directory, 'maestro-current')
        fs.mkdirSync(output, { recursive: true })
        const captured = command('tapOnElement', 'tab-home', 'FAILED', 4, 1)
        captured.metadata.artifacts = [{ type: 'SCREEN_HIERARCHY', path: 'capture.json' }]
        const failed = command(
          'scrollUntilVisible',
          'outfit-share-card-open',
          'FAILED',
          8,
          2
        )
        const running = command('tapOnElement', 'share-card-save', 'RUNNING', 9, 3)
        const byKind = { captured, failed, running }
        if (separate) {
          order.forEach((kind, index) => {
            const dir = path.join(output, String(index))
            fs.mkdirSync(dir)
            fs.writeFileSync(
              path.join(dir, 'commands.json'),
              JSON.stringify([byKind[kind]])
            )
            if (kind === 'captured')
              fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(hierarchy))
          })
        } else {
          fs.writeFileSync(
            path.join(output, 'commands.json'),
            JSON.stringify(order.map((kind) => byKind[kind]))
          )
          fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(hierarchy))
        }
        const result = await collectNativeFlowDiagnostics(
          {
            ...context,
            root,
            directory,
            output,
            device: 'emulator-5554',
            adb: '/owned/adb',
            startedAt: Date.now(),
          },
          { execute: () => ({ status: 1, stdout: '' }) }
        )
        assert.equal(result.failedCommand.selector.value, 'outfit-share-card-open')
        assert.equal(result.failedCommand.status, 'FAILED')
      })
    }
  }
})
