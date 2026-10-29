import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import pg from 'pg'
import { createServer } from 'node:http'
import { story68FocusObservationHandler } from './story68-ios-focus-observation.mjs'
import { assertRapidWatermarkRuntime } from './story68-rapid-watermark.mjs'
import { withUnavailableOwnedFallbackPost } from './story68-fallback-post.mjs'
import { xcodebuildFailureReport } from './share-card-audit-report.mjs'

function recorded(ctx, binary, args, name, env = {}) {
  const file = path.join(ctx.directory, name)
  const fd = fs.openSync(file, 'w', 0o600)
  const result = spawnSync(binary, args, {
    cwd: ctx.root,
    env: { ...process.env, ...env },
    stdio: ['ignore', fd, fd],
    detached: true,
    timeout: 180_000,
    killSignal: 'SIGTERM',
  })
  fs.closeSync(fd)
  if (result.error?.code === 'ETIMEDOUT' && result.pid) {
    try {
      process.kill(-result.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  if (result.error || result.status !== 0)
    throw new Error('fallback_native_assertion_failed')
  return fs.readFileSync(file, 'utf8')
}
export async function recordedIosTest(ctx, args, name, spawnChild = spawn) {
  const file = path.join(ctx.directory, name)
  const fd = fs.openSync(file, 'w', 0o600)
  try {
    await new Promise((resolve, reject) => {
      const child = spawnChild('xcodebuild', args, {
        cwd: ctx.root,
        stdio: ['ignore', fd, fd],
        detached: true,
      })
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') reject(error)
        }
      }, 180_000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else {
          // The xcodebuild log is private; the job log gets what names the failed step.
          console.log(
            JSON.stringify({
              iosFallbackFailure: xcodebuildFailureReport(fs.readFileSync(file, 'utf8')),
            })
          )
          reject(new Error('fallback_native_assertion_failed'))
        }
      })
    })
    return fs.readFileSync(file, 'utf8')
  } finally {
    fs.closeSync(fd)
  }
}
export async function withIosFocusObservation(ctx, work, port = 63068) {
  const observe = story68FocusObservationHandler({
    device: ctx.device,
    appId: ctx.appId,
    readContainer: () =>
      ctx.run('xcrun', ['simctl', 'get_app_container', ctx.device, ctx.appId, 'data']),
  })
  const server = createServer((request, response) => {
    if (!observe(request, response)) response.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  try {
    return await work(server.address().port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
function freshRuntime(ctx) {
  if (ctx.platform === 'ios')
    ctx.run('xcrun', ['simctl', 'terminate', ctx.device, ctx.appId])
  else ctx.run(ctx.adb, ['-s', ctx.device, 'shell', 'am', 'force-stop', ctx.appId])
  ctx.openUrl(
    `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
  )
  ctx.maestro('maestro/story65/open-app.yaml')
}
export async function revalidated(file, offset, owner) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const observed = fs
      .readFileSync(file)
      .subarray(offset)
      .toString()
      .split('\n')
      .some((line) => {
        try {
          const row = JSON.parse(line)
          return (
            row.path === '/api/v1/community/targets/resolve' &&
            row.method === 'POST' &&
            row.statusCode === 200 &&
            row.userId === owner
          )
        } catch {
          return false
        }
      })
    if (observed) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('actual_owned_foreground_revalidation_required')
}
export function iosAssertion(ctx, fixtures) {
  const generated = path.join(ctx.directory, 'fallback-accessibility-project')
  fs.mkdirSync(generated, { recursive: true, mode: 0o700 })
  for (const [source, target] of [
    ['fallback-project.yml', 'project.yml'],
    ['ShareCardFallbackUITests.swift', 'ShareCardFallbackUITests.swift'],
    ['ShareCardHeaderSemantics.swift', 'ShareCardHeaderSemantics.swift'],
    ['ShareCardHeaderQuery.swift', 'ShareCardHeaderQuery.swift'],
  ])
    fs.copyFileSync(
      path.join(ctx.root, 'apps/mobile/native-tests', source),
      path.join(generated, target)
    )
  const catalog = JSON.parse(
    fs.readFileSync(path.join(ctx.root, 'apps/mobile/assets/locales/en-US.json'), 'utf8')
  )
  fs.writeFileSync(
    path.join(generated, 'fallback-fixture.json'),
    JSON.stringify({
      postId: fixtures.postId,
      community: catalog.tabs.community,
      title: catalog.shareCard.title,
      cancel: catalog.shareCard.cancel,
      removedHeading: catalog.community.heading,
    }),
    { mode: 0o600 }
  )
  ctx.run('xcodegen', [
    'generate',
    '--spec',
    path.join(generated, 'project.yml'),
    '--project',
    generated,
  ])
  const args = [
    '-project',
    path.join(generated, 'ShareCardFallback.xcodeproj'),
    '-scheme',
    'ShareCardFallback',
    '-destination',
    `platform=iOS Simulator,id=${ctx.device}`,
    '-collect-test-diagnostics',
    'never',
    '-derivedDataPath',
    path.join(ctx.directory, 'fallback-accessibility-build'),
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGNING_ALLOWED=YES',
    'CODE_SIGNING_REQUIRED=NO',
  ]
  recorded(
    ctx,
    'xcodebuild',
    ['build-for-testing', ...args],
    'fallback-native-ios-build.log'
  )
  return async () => {
    const result = path.join(
      ctx.directory,
      `fallback-accessibility-${Date.now()}.xcresult`
    )
    const log = await recordedIosTest(
      ctx,
      ['test-without-building', ...args, '-resultBundlePath', result],
      'fallback-native-ios.log'
    )
    const summary = JSON.parse(
      ctx.run('xcrun', [
        'xcresulttool',
        'get',
        'test-results',
        'summary',
        '--path',
        result,
      ])
    )
    const tree = JSON.parse(
      ctx.run('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', result])
    )
    const tests = []
    const visit = (node) => {
      if (node.nodeType === 'Test Case') tests.push(node)
      for (const child of node.children ?? []) visit(child)
    }
    for (const node of tree.testNodes ?? []) visit(node)
    if (
      summary.result !== 'Passed' ||
      summary.totalTestCount !== 1 ||
      summary.passedTests !== 1 ||
      tests.length !== 1 ||
      tests[0].nodeIdentifier !==
        'ShareCardFallbackUITests/testRemovedCommunityOpenerLeavesExistingHeaderAndPassesAllAudit()' ||
      tests[0].result !== 'Passed' ||
      !log.includes('CC68_FALLBACK_PASS ios existing-header-target-and-all-audit')
    )
      throw new Error('fallback_ios_all_audit_required')
    return {
      method: 'XCUITest simulator substitute',
      actualCursor: false,
      intendedHeaderTarget: true,
      strictAuditAll: true,
      postRemoved: true,
    }
  }
}
async function withTalkBack(ctx, work) {
  const get = (key) =>
    ctx.run(ctx.adb, ['-s', ctx.device, 'shell', 'settings', 'get', 'secure', key]).trim()
  const previous = get('enabled_accessibility_services')
  const enabled = get('accessibility_enabled')
  const env = {
    ...ctx.read('public-build-env.json'),
    ANDROID_SERIAL: ctx.device,
    ANDROID_HOME: process.env.ANDROID_HOME ?? path.dirname(path.dirname(ctx.adb)),
    ADB: ctx.adb,
  }
  try {
    ctx.run(
      path.join(ctx.root, 'apps/mobile/android/gradlew'),
      [
        '-p',
        path.join(ctx.root, 'apps/mobile/android'),
        ':accessibility-focus:assembleDebugAndroidTest',
        '--max-workers=2',
      ],
      env
    )
    ctx.run(ctx.adb, [
      '-s',
      ctx.device,
      'install',
      '-r',
      path.join(
        ctx.root,
        'apps/mobile/modules/accessibility-focus/android/build/outputs/apk/androidTest/debug/accessibility-focus-debug-androidTest.apk'
      ),
    ])
    ctx.run('bash', ['scripts/ci/android-talkback.sh', 'enable'], env)
    return await work()
  } finally {
    if (!previous || previous === 'null')
      ctx.run(ctx.adb, [
        '-s',
        ctx.device,
        'shell',
        'settings',
        'delete',
        'secure',
        'enabled_accessibility_services',
      ])
    else
      ctx.run(ctx.adb, [
        '-s',
        ctx.device,
        'shell',
        'settings',
        'put',
        'secure',
        'enabled_accessibility_services',
        previous,
      ])
    ctx.run(ctx.adb, [
      '-s',
      ctx.device,
      'shell',
      'settings',
      'put',
      'secure',
      'accessibility_enabled',
      enabled === 'null' ? '0' : enabled,
    ])
  }
}
export function androidAssertion(ctx, fixtures) {
  return () => {
    const log = recorded(
      ctx,
      ctx.adb,
      [
        '-s',
        ctx.device,
        'shell',
        'am',
        'instrument',
        '-w',
        '-e',
        'class',
        'expo.modules.accessibilityfocus.ShareCardFallbackTalkBackTest',
        '-e',
        'CC68_FALLBACK_POST_ID',
        fixtures.postId,
        'expo.modules.accessibilityfocus.test/androidx.test.runner.AndroidJUnitRunner',
      ],
      'fallback-native-android.log'
    )
    if (
      !/OK \(1 test\)/.test(log) ||
      /FAILURES|INSTRUMENTATION_FAILED/.test(log) ||
      !log.includes('CC68_FALLBACK_PASS android actual-talkback-community-header')
    )
      throw new Error('fallback_actual_talkback_cursor_required')
    return {
      method: 'actual TalkBack',
      actualCursor: true,
      existingHeaderTrait: true,
      postRemoved: true,
    }
  }
}
async function journey(ctx, runtime, fixtures, assertion) {
  freshRuntime(ctx)
  ctx.maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: 'en-US' })
  ctx.maestro('maestro/story68/open-post.yaml')
  const owner = fixtures.identities.find(
    (item) => item.label === 'cc68-primary'
  ).appUserId
  const result = await withUnavailableOwnedFallbackPost({
    runtime,
    fixtures,
    createClient: (options) => new pg.Client(options),
    whileUnavailable: async () => {
      const file = path.join(ctx.directory, 'api.log')
      const offset = fs.statSync(file).size
      ctx.maestro('maestro/story68/fallback-foreground.yaml')
      await revalidated(file, offset, owner)
      return assertion()
    },
  })
  freshRuntime(ctx)
  return {
    ...result.value,
    actualForegroundRevalidation: true,
    ownedPostContentRestored: result.contentRestored,
  }
}
export async function runStory68FallbackFocus(ctx) {
  ctx.privateJson(`native-fallback-focus-${ctx.platform}.json`, {
    platform: ctx.platform,
    passed: false,
  })
  try {
    const runtime = {
      environment: ctx.read('owned-env.json'),
      build: ctx.read('public-build-env.json'),
      resources: ctx.read('resources.json'),
      apiLog: fs.readFileSync(path.join(ctx.directory, 'api.log'), 'utf8'),
    }
    assertRapidWatermarkRuntime(runtime)
    const fixtures = ctx.read('fixtures.json')
    const result =
      ctx.platform === 'android'
        ? await withTalkBack(ctx, () =>
            journey(ctx, runtime, fixtures, androidAssertion(ctx, fixtures))
          )
        : await withIosFocusObservation(ctx, () =>
            journey(ctx, runtime, fixtures, iosAssertion(ctx, fixtures))
          )
    ctx.privateJson(`native-fallback-focus-${ctx.platform}.json`, {
      platform: ctx.platform,
      passed: true,
      ...result,
    })
  } catch (error) {
    const codes = [
      'owned_fallback_post_identity_required',
      'owned_fallback_post_changed',
      'owned_fallback_post_write_mismatch',
      'owned_fallback_restore_failed',
      'actual_owned_foreground_revalidation_required',
      'fallback_native_assertion_failed',
      'fallback_ios_all_audit_required',
      'fallback_actual_talkback_cursor_required',
    ]
    ctx.privateJson(`native-fallback-focus-${ctx.platform}.json`, {
      platform: ctx.platform,
      passed: false,
      code:
        error instanceof Error && codes.includes(error.message)
          ? error.message
          : 'fallback_focus_failed',
    })
    throw error
  }
}
