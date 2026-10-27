import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { describe } from 'node:test'
import { spawn } from 'node:child_process'
import {
  androidAssertion,
  iosAssertion,
  revalidated,
  runStory68FallbackFocus,
  recordedIosTest,
  withIosFocusObservation,
} from './story68-fallback-focus.mjs'

test('misrouted fallback preflight closes an older passing record before any native action', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-fallback-preflight-'))
  const records = [{ platform: 'ios', passed: true }]
  let nativeCalls = 0
  try {
    fs.writeFileSync(path.join(directory, 'api.log'), '')
    const ctx = {
      directory,
      platform: 'ios',
      read: () => ({}),
      privateJson: (name, record) => {
        assert.equal(name, 'native-fallback-focus-ios.json')
        records.push(record)
      },
      run: () => nativeCalls++,
      maestro: () => nativeCalls++,
      openUrl: () => nativeCalls++,
    }
    await assert.rejects(runStory68FallbackFocus(ctx))
    assert.equal(nativeCalls, 0)
    assert.equal(records.at(-1).passed, false)
    assert.equal(records.at(-1).code, 'fallback_focus_failed')
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})

test('actual asynchronous fallback runner serves UIKit observations while its native child waits', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-fallback-observation-'))
  const device = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
  const container = path.join(
    directory,
    `Devices/${device}/data/Containers/Data/Application/owned`
  )
  fs.mkdirSync(path.join(container, 'Documents'), { recursive: true })
  fs.writeFileSync(
    path.join(container, 'Documents/cc68-focus-observation.json'),
    JSON.stringify({
      session: device,
      sequence: 2,
      identifier: 'heading',
      label: 'Community',
      attached: true,
      posted: true,
      header: true,
      headings: ['Community'],
    })
  )
  try {
    await withIosFocusObservation(
      { device, appId: 'com.couturecast.story68', run: () => container },
      async (port) => {
        const log = await recordedIosTest(
          { directory },
          [],
          'child.log',
          (_binary, _args, options) =>
            spawn(
              process.execPath,
              [
                '-e',
                `require('node:http').get('http://127.0.0.1:${port}/focus-observation', response => { let data=''; response.on('data', chunk=>data+=chunk); response.on('end', ()=>{ if(response.statusCode!==200||JSON.parse(data).header!==true)process.exit(2); console.log('actual native child received observed header'); }); }).on('error', ()=>process.exit(3));`,
              ],
              options
            )
        )
        assert.match(log, /actual native child received observed header/)
      },
      0
    )
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})

describe('fallback-focus fail-closed guards', () => {
  const owner = 'cc68-native-00000000-0000-4000-8000-000000000001'
  const resolved = (overrides = {}) =>
    JSON.stringify({
      path: '/api/v1/community/targets/resolve',
      method: 'POST',
      statusCode: 200,
      userId: owner,
      ...overrides,
    })
  const withDirectory = async (work) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-fallback-guard-'))
    try {
      return await work(directory)
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  }
  // An executable stand-in for adb/xcodebuild that prints a fixed log and exits.
  const fakeBinary = (directory, name, log, status = 0) => {
    const file = path.join(directory, name)
    fs.writeFileSync(path.join(directory, `${name}.out`), log)
    fs.writeFileSync(file, `#!/bin/sh\ncat '${file}.out'\nexit ${status}\n`, {
      mode: 0o700,
    })
    return file
  }
  const runRevalidation = async (t, file, offset) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const outcome = revalidated(file, offset, owner).then(
      () => 'revalidated',
      (error) => error.message
    )
    for (let step = 0; step < 90; step++) {
      await new Promise((resolve) => setImmediate(resolve))
      t.mock.timers.tick(100)
    }
    return outcome
  }

  test('foreground revalidation accepts only the owner resolve after the offset', async (t) => {
    await withDirectory(async (directory) => {
      const file = path.join(directory, 'api.log')
      const before = `${resolved()}\n`
      fs.writeFileSync(file, before + `${resolved()}\n`)
      assert.equal(await runRevalidation(t, file, before.length), 'revalidated')
    })
  })

  for (const [name, row] of [
    ['an earlier resolve before the offset', null],
    ['a failed resolve', resolved({ statusCode: 503 })],
    ['another member', resolved({ userId: 'cc68-native-other' })],
    ['a GET request', resolved({ method: 'GET' })],
    ['another path', resolved({ path: '/api/v1/community/feed' })],
    ['an unparsable line', '{"path":'],
  ])
    test(`foreground revalidation fails closed on ${name}`, async (t) => {
      await withDirectory(async (directory) => {
        const file = path.join(directory, 'api.log')
        const before = `${resolved()}\n`
        fs.writeFileSync(file, before + (row ? `${row}\n` : ''))
        assert.equal(
          await runRevalidation(t, file, before.length),
          'actual_owned_foreground_revalidation_required'
        )
      })
    })

  const androidCtx = (directory, log, status) => ({
    directory,
    root: directory,
    device: 'emulator-5584',
    adb: fakeBinary(directory, 'adb', log, status),
  })
  const passing =
    'CC68_FALLBACK_PASS android actual-talkback-community-header\nOK (1 test)\n'

  test('Android fallback accepts only one passing TalkBack test with its marker', async () => {
    await withDirectory(async (directory) => {
      const result = androidAssertion(androidCtx(directory, passing), { postId: 'p' })()
      assert.equal(result.actualCursor, true)
    })
  })

  for (const [name, log, status, code] of [
    ['a non-zero instrumentation exit', passing, 1, 'fallback_native_assertion_failed'],
    [
      'a missing pass marker',
      'OK (1 test)\n',
      0,
      'fallback_actual_talkback_cursor_required',
    ],
    [
      'a reported failure',
      `${passing}FAILURES!!!\n`,
      0,
      'fallback_actual_talkback_cursor_required',
    ],
    [
      'an instrumentation crash',
      `${passing}INSTRUMENTATION_FAILED\n`,
      0,
      'fallback_actual_talkback_cursor_required',
    ],
    [
      'a different test count',
      'CC68_FALLBACK_PASS android actual-talkback-community-header\nOK (2 tests)\n',
      0,
      'fallback_actual_talkback_cursor_required',
    ],
  ])
    test(`Android fallback fails closed on ${name}`, async () => {
      await withDirectory(async (directory) => {
        assert.throws(
          () => androidAssertion(androidCtx(directory, log, status), { postId: 'p' })(),
          { message: code }
        )
      })
    })

  const identifier =
    'ShareCardFallbackUITests/testRemovedCommunityOpenerLeavesExistingHeaderAndPassesAllAudit()'
  const summary = { result: 'Passed', totalTestCount: 1, passedTests: 1 }
  const tree = (nodes) => ({
    testNodes: [{ nodeType: 'Unit test bundle', children: nodes }],
  })
  const passedCase = {
    nodeType: 'Test Case',
    nodeIdentifier: identifier,
    result: 'Passed',
  }
  const iosMarker = 'CC68_FALLBACK_PASS ios existing-header-target-and-all-audit\n'
  const runIos = async (t, { log = iosMarker, status = 0, report = summary, nodes }) =>
    withDirectory(async (directory) => {
      const root = path.join(directory, 'root')
      fs.mkdirSync(path.join(root, 'apps/mobile/native-tests'), { recursive: true })
      fs.mkdirSync(path.join(root, 'apps/mobile/assets/locales'), { recursive: true })
      for (const name of [
        'fallback-project.yml',
        'ShareCardFallbackUITests.swift',
        'ShareCardHeaderSemantics.swift',
        'ShareCardHeaderQuery.swift',
      ])
        fs.writeFileSync(path.join(root, 'apps/mobile/native-tests', name), '')
      fs.writeFileSync(
        path.join(root, 'apps/mobile/assets/locales/en-US.json'),
        JSON.stringify({
          tabs: { community: 'Community' },
          shareCard: { title: 'Share card', cancel: 'Cancel' },
          community: { heading: 'Lookbook' },
        })
      )
      const bin = path.join(directory, 'bin')
      fs.mkdirSync(bin)
      // build-for-testing always succeeds; the guarded test run gets the case's log and status.
      fs.writeFileSync(path.join(bin, 'xcodebuild.out'), log)
      fs.writeFileSync(
        path.join(bin, 'xcodebuild'),
        `#!/bin/sh\n[ "$1" = test-without-building ] || exit 0\ncat '${bin}/xcodebuild.out'\nexit ${status}\n`,
        { mode: 0o700 }
      )
      const previousPath = process.env.PATH
      process.env.PATH = `${bin}:${previousPath}`
      try {
        const ctx = {
          directory,
          root,
          device: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
          run: (_binary, args) =>
            args.includes('summary')
              ? JSON.stringify(report)
              : args.includes('tests')
                ? JSON.stringify(tree(nodes ?? [passedCase]))
                : '',
        }
        return await Promise.resolve()
          .then(() => iosAssertion(ctx, { postId: 'p' })())
          .then(
            (value) => value,
            (error) => error.message
          )
      } finally {
        process.env.PATH = previousPath
      }
    })

  test('iOS fallback accepts only the one exact passing audit test with its marker', async (t) => {
    const result = await runIos(t, {})
    assert.equal(result.strictAuditAll, true)
  })

  for (const [name, input, code] of [
    ['a non-zero xcodebuild exit', { status: 65 }, 'fallback_native_assertion_failed'],
    [
      'a missing pass marker',
      { log: 'Test Suite passed\n' },
      'fallback_ios_all_audit_required',
    ],
    [
      'a failed summary',
      { report: { ...summary, result: 'Failed' } },
      'fallback_ios_all_audit_required',
    ],
    [
      'an extra test',
      { report: { ...summary, totalTestCount: 2 } },
      'fallback_ios_all_audit_required',
    ],
    [
      'zero passed tests',
      { report: { ...summary, passedTests: 0 } },
      'fallback_ios_all_audit_required',
    ],
    ['no test nodes', { nodes: [] }, 'fallback_ios_all_audit_required'],
    [
      'another test identifier',
      {
        nodes: [
          { ...passedCase, nodeIdentifier: 'ShareCardFallbackUITests/testOther()' },
        ],
      },
      'fallback_ios_all_audit_required',
    ],
    [
      'a skipped test node',
      { nodes: [{ ...passedCase, result: 'Skipped' }] },
      'fallback_ios_all_audit_required',
    ],
  ])
    test(`iOS fallback fails closed on ${name}`, async (t) => {
      assert.equal(await runIos(t, input), code)
    })
})
