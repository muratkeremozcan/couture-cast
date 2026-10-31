import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  proveReleaseLiveFont,
  assertReleaseTextPreserved,
} from './story68-release-live-font.mjs'
import {
  RESTORE_DEADLINE_MS,
  RETRY_PAUSE_MS,
  STABLE_WINDOW_MS,
  activityDump,
  app,
  configuration,
  fixture,
  sha,
  tree,
} from './story68-release-live-font-fixtures.mjs'

describe('Release live-font target and install guards', () => {
  test('empty installed package evidence fails before any app or font mutation', async () => {
    const f = fixture()
    const shell = f.io.shell
    f.io.shell = (args) => (args[0] === 'dumpsys' ? '' : shell(args))
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /non_debuggable_release_required/
    )
    assert.equal(
      f.events.some((event) => /force-stop|settings put/.test(event)),
      false
    )
  })

  for (const [name, mutate, code] of [
    [
      'wrong owned runtime',
      (config) => {
        config.runtime.environment.DATABASE_URL = 'postgresql://x@127.0.0.1/postgres'
      },
      /owned_uuid_loopback_database_required/,
    ],
    [
      'wrong app',
      (config) => {
        config.appId = 'com.other.app'
      },
      /owned_release_font_target_required/,
    ],
    [
      'implicit device',
      (config) => {
        config.device = undefined
      },
      /owned_release_font_target_required/,
    ],
    [
      'remote Auth',
      (config) => {
        config.runtime.build.EXPO_PUBLIC_SUPABASE_URL = 'https://auth.example.test'
      },
      /owned_release_font_auth_required/,
    ],
  ]) {
    test(`${name} is rejected before device commands`, async () => {
      const f = fixture()
      const config = configuration()
      mutate(config)
      await assert.rejects(proveReleaseLiveFont(config, f.io), code)
      assert.deepEqual(f.events, [])
    })
  }

  for (const [name, change, code] of [
    [
      'debuggable package',
      { package: `Package [${app}]\nflags=[ DEBUGGABLE HAS_CODE ]` },
      /non_debuggable_release_required/,
    ],
    ['wrong AVD', { avd: 'shared-avd' }, /owned_avd_and_safe_even_port_required/],
    ['wrong installed APK', { hash: 'c'.repeat(64) }, /installed_release_apk_mismatch/],
  ]) {
    test(`${name} fails before mutation`, async () => {
      const f = fixture()
      const shell = f.io.shell
      f.io.shell = (args) =>
        args[0] === 'dumpsys' && change.package
          ? change.package
          : args[0] === 'toybox' && change.hash
            ? change.hash
            : shell(args)
      if (change.avd) f.io.avdName = async () => change.avd
      await assert.rejects(proveReleaseLiveFont(configuration(), f.io), code)
      assert.equal(
        f.events.some((event) => /force-stop|settings put/.test(event)),
        false
      )
    })
  }
})

describe('Release live-font production before state', () => {
  test('actual proof changes font live only after exact production OFF state and cold-restores before success', async () => {
    const f = fixture()
    const result = await proveReleaseLiveFont(configuration(), f.io)
    assert.equal(result.passed, true)
    assert.equal(result.beforeTitleHeight, 92)
    assert.equal(result.afterTitleHeight, 138)
    const baseline = f.events.indexOf('settings put system font_scale 1.0')
    assert.equal(f.events[baseline - 1], `am force-stop ${app}`)
    const live = f.events.indexOf('settings put system font_scale 1.5')
    assert.ok(live > f.events.indexOf('private before'))
    assert.equal(
      f.events.slice(baseline + 1, live).some((event) => event.includes('force-stop')),
      false
    )
    assert.deepEqual(f.events.slice(-2), [
      `am force-stop ${app}`,
      'settings put system font_scale 1.2',
    ])
    assert.deepEqual(
      f.events.filter((event) => event.startsWith('flow ')),
      [
        'flow maestro/story65/set-locale.yaml',
        'flow maestro/story68/release-open-outfit.yaml',
        'flow maestro/story68/release-watermark-off.yaml',
      ]
    )
    assert.equal(result.originalFontRestored, true)
    assert.equal(
      Object.values(result).some((value) => typeof value === 'object'),
      false
    )
    assert.equal(JSON.stringify(result).includes('Outfit. Morning'), false)
  })

  test('Release proof supplies the exact locale required by the real Settings fragment', async () => {
    const f = fixture()
    const maestro = f.io.maestro
    f.io.maestro = async (flow, env) => {
      if (flow === 'maestro/story65/set-locale.yaml') {
        assert.deepEqual(env, { MAESTRO_LOCALE: 'en-US' })
      }
      return maestro(flow)
    }
    assert.equal((await proveReleaseLiveFont(configuration(), f.io)).passed, true)
  })

  for (const [name, state, code] of [
    [
      'digest-only debug preview',
      { previewId: `share-card-preview-loaded-${sha}` },
      /release_production_preview_required/,
    ],
    [
      'wrong localized title',
      { title: 'Another card' },
      /release_localized_title_required/,
    ],
    ['watermark ON', { checked: 'true' }, /release_watermark_off_required/],
    [
      'wrong full source label',
      { label: 'Different source. CoutureCast' },
      /release_full_render_label_required/,
    ],
  ]) {
    test(`${name} cannot establish the before state and always restores the original font`, async () => {
      const f = fixture({ hierarchy: async () => tree(state) })
      await assert.rejects(proveReleaseLiveFont(configuration(), f.io), code)
      assert.equal(f.events.includes('settings put system font_scale 1.5'), false)
      assert.deepEqual(f.events.slice(-2), [
        `am force-stop ${app}`,
        'settings put system font_scale 1.2',
      ])
    })
  }

  test('new exact native fragment failures retain assertion classification through the closed schema', async () => {
    const { summarizeNativeFlowFailure, assertNativeFlowFailure } = await import(
      './share-card-native-failure.mjs'
    )
    for (const name of ['release-open-outfit.yaml', 'release-watermark-off.yaml']) {
      const record = summarizeNativeFlowFailure({
        flow: `maestro/story68/${name}`,
        platform: 'android',
        durationMs: 1234,
        log: 'maestro.MaestroException$AssertionFailure: Assertion is false',
      })
      assert.equal(record.flow, name)
      assert.equal(record.classification, 'assertion')
      assertNativeFlowFailure(record)
    }
  })
})

describe('Release live-font text and process preservation', () => {
  test('pre-existing renderer clipping records unchanged height while preserving every text node', async () => {
    const f = fixture({ hierarchy: async () => tree() })
    const result = await proveReleaseLiveFont(configuration(), f.io)
    assert.equal(result.beforeTitleHeight, result.afterTitleHeight)
    assert.equal(result.textNodesPreserved, true)
    assert.equal(result.beforeTextNodes, result.afterTextNodes)
  })

  for (const mutation of ['missing', 'changed', 'duplicated']) {
    test(`live font ${mutation} body text fails even when title and card state survive`, async () => {
      let reads = 0
      const f = fixture({
        hierarchy: async () => {
          const after = reads++ > 0
          const value = tree({ height: after ? 138 : 92 })
          if (!after || mutation !== 'missing')
            value.children.push({
              attributes: {
                'resource-id': 'card-body',
                text: after && mutation === 'changed' ? 'Changed label' : 'Card body',
              },
            })
          if (after && mutation === 'duplicated')
            value.children.push({
              attributes: {
                'resource-id': 'card-body',
                text: 'Card body',
              },
            })
          return value
        },
      })
      await assert.rejects(
        proveReleaseLiveFont(configuration(), f.io),
        /release_text_nodes_changed/
      )
      assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
    })
  }

  test('text identity comparison retains multiplicity and labels while excluding only the changing system clock', () => {
    const before = tree()
    before.children.push({
      attributes: {
        'resource-id': 'com.android.systemui:id/clock',
        text: '10:59',
      },
    })
    const after = tree({ height: 138 })
    after.children.push({
      attributes: {
        'resource-id': 'com.android.systemui:id/clock',
        text: '11:00',
      },
    })
    assert.deepEqual(assertReleaseTextPreserved(before, after), {
      beforeTextNodes: 1,
      afterTextNodes: 1,
      textNodesPreserved: true,
    })
    after.children[0].attributes.accessibilityText = 'Different accessible title'
    assert.throws(
      () => assertReleaseTextPreserved(before, after),
      /release_text_nodes_changed/
    )
    assert.throws(
      () => assertReleaseTextPreserved({ children: [] }, { children: [] }),
      /release_text_nodes_changed/
    )
  })

  test('a changed process and a crash log each fail the actual proof', async () => {
    for (const crash of [false, true]) {
      const f = fixture()
      let pidReads = 0
      const shell = f.io.shell
      f.io.shell = (args) =>
        args[0] === 'pidof' && ++pidReads > 1 && !crash ? '99999' : shell(args)
      let logReads = 0
      if (crash) f.io.logcat = async () => (++logReads > 1 ? 'FATAL EXCEPTION: main' : '')
      await assert.rejects(
        proveReleaseLiveFont(configuration(), f.io),
        crash ? /release_crash_log/ : /release_process_changed/
      )
      assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
    }
  })

  test('an actual error surface cannot satisfy restored state', async () => {
    let reads = 0
    const f = fixture({
      hierarchy: async () => {
        const value = tree({ height: reads++ === 0 ? 92 : 138 })
        if (reads > 1)
          value.children.push({ attributes: { 'resource-id': 'hero-error-state' } })
        return value
      },
    })
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_error_surface/
    )
    assert.ok(f.now() < RESTORE_DEADLINE_MS)
  })
})

describe('Release live-font restoration deadline', () => {
  test('actual observed modal loss fails at the original 20-second deadline with cleanup', async () => {
    let snapshots = 0
    const f = fixture({
      hierarchy: async () => (snapshots++ === 0 ? tree() : { children: [] }),
    })
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_production_preview_required/
    )
    assert.equal(f.now(), RESTORE_DEADLINE_MS)
    assert.deepEqual(f.events.slice(-2), [
      `am force-stop ${app}`,
      'settings put system font_scale 1.2',
    ])
  })

  for (const [name, state, code] of [
    [
      'changed source after recreation',
      { label: 'Different source. CoutureCast' },
      /release_full_render_label_required/,
    ],
    [
      'reset watermark after recreation',
      { checked: 'true' },
      /release_watermark_off_required/,
    ],
    [
      'reset locale after recreation',
      { title: 'Otra tarjeta' },
      /release_localized_title_required/,
    ],
  ]) {
    test(`${name} fails within the original deadline`, async () => {
      let reads = 0
      const f = fixture({
        hierarchy: async () => (reads++ === 0 ? tree() : tree({ height: 138, ...state })),
      })
      await assert.rejects(proveReleaseLiveFont(configuration(), f.io), code)
      assert.equal(f.now(), RESTORE_DEADLINE_MS)
      assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
    })
  }

  test('snapshot commands use measured 20s headroom and the remaining restoration deadline', async () => {
    const slowSnapshotMs = 8000
    const finalSnapshotMs = 2000
    const timeouts = []
    let snapshots = 0
    const f = fixture()
    f.io.hierarchy = async (timeout) => {
      timeouts.push(timeout)
      snapshots++
      if (snapshots === 1) return tree()
      await f.io.pause(snapshots === 4 ? finalSnapshotMs : slowSnapshotMs)
      return snapshots === 2 ? { children: [] } : tree({ height: 138 })
    }
    const result = await proveReleaseLiveFont(configuration(), f.io)
    assert.equal(result.passed, true)
    // The lost card costs one slow snapshot plus a retry pause; the first preserved
    // state costs another slow snapshot plus one stable window before the last read.
    const afterLostCard = RESTORE_DEADLINE_MS - slowSnapshotMs - RETRY_PAUSE_MS
    assert.deepEqual(timeouts, [
      RESTORE_DEADLINE_MS,
      RESTORE_DEADLINE_MS,
      afterLostCard,
      afterLostCard - slowSnapshotMs - STABLE_WINDOW_MS,
    ])
  })

  test('a snapshot arriving after the restoration deadline cannot pass', async () => {
    const f = fixture()
    let reads = 0
    f.io.hierarchy = async () => {
      if (reads++ === 0) return tree()
      await f.io.pause(RESTORE_DEADLINE_MS + 1)
      return tree({ height: 138 })
    }
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_restore_deadline/
    )
    assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
  })

  test('a snapshot cut off by the deadline reports the state that never settled', async () => {
    // CI run 41179795488: the after state kept failing, and the last snapshot, bounded by the
    // remaining deadline, was killed. The proof must name the state, never the killed command.
    const f = fixture()
    let reads = 0
    const cutOff = new Error('release_font_native_command_failed')
    f.io.hierarchy = async (timeout) => {
      if (reads++ === 0) return tree()
      if (f.now() + 3000 >= RESTORE_DEADLINE_MS) {
        await f.io.pause(timeout)
        throw cutOff
      }
      return tree({ height: 138, title: 'Another title' })
    }
    await assert.rejects(proveReleaseLiveFont(configuration(), f.io), (error) => {
      assert.equal(error.message, 'release_localized_title_required')
      assert.equal(error.cause, cutOff)
      return true
    })
    assert.equal(f.now(), RESTORE_DEADLINE_MS)
    assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
  })

  test('an after snapshot that fails before any state was read stays a command failure', async () => {
    const f = fixture()
    let reads = 0
    f.io.hierarchy = async () => {
      if (reads++ === 0) return tree()
      throw new Error('release_font_native_command_failed')
    }
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_font_native_command_failed/
    )
    assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
  })

  test('a read that fails inside the deadline after a failed state stays a command failure', async () => {
    const f = fixture()
    let reads = 0
    f.io.hierarchy = async () => {
      reads++
      if (reads === 1) return tree()
      if (reads === 2) return tree({ height: 138, title: 'Another title' })
      throw new Error('release_font_native_command_failed')
    }
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_font_native_command_failed/
    )
    assert.ok(f.now() < RESTORE_DEADLINE_MS)
  })

  test('after snapshot skips driver reinstall only after the verified production baseline', async () => {
    const f = fixture()
    const stages = []
    const hierarchy = f.io.hierarchy
    f.io.hierarchy = async (timeout, stage) => {
      stages.push({
        timeout,
        stage,
        live: f.events.includes('settings put system font_scale 1.5'),
      })
      return hierarchy()
    }
    await proveReleaseLiveFont(configuration(), f.io)
    assert.deepEqual(stages, [
      { timeout: RESTORE_DEADLINE_MS, stage: 'before', live: false },
      { timeout: RESTORE_DEADLINE_MS, stage: 'after', live: true },
      { timeout: RESTORE_DEADLINE_MS - STABLE_WINDOW_MS, stage: 'after', live: true },
    ])
  })
})

describe('Release live-font cleanup and failure evidence', () => {
  test('cleanup retains assertion error and refuses a hot restore when the final stop fails', async () => {
    const f = fixture({ hierarchy: async () => tree({ label: 'Wrong' }) })
    const shell = f.io.shell
    let stops = 0
    const cleanup = new Error('stop_failed')
    f.io.shell = (args) => {
      if (args[0] === 'am' && args[1] === 'force-stop' && ++stops === 2) throw cleanup
      return shell(args)
    }
    await assert.rejects(proveReleaseLiveFont(configuration(), f.io), (error) => {
      assert.equal(error.message, 'release_font_restore_failed')
      assert.match(error.errors[0].message, /release_full_render_label_required/)
      assert.equal(error.errors[1], cleanup)
      return true
    })
    assert.equal(f.events.includes('settings put system font_scale 1.2'), false)
  })

  test('baseline font write acknowledgement failure still deletes an originally absent setting', async () => {
    const original = new Error('setting_ack_lost')
    const f = fixture()
    const shell = f.io.shell
    f.io.shell = (args) => {
      if (args.join(' ') === 'settings get system font_scale') return 'null'
      if (args.join(' ') === 'settings put system font_scale 1.0') throw original
      return shell(args)
    }
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      (error) => error === original
    )
    assert.deepEqual(f.events.slice(-2), [
      `am force-stop ${app}`,
      'settings delete system font_scale',
    ])
  })

  test('lost-card timeout collects private failure evidence before cold cleanup without replacing its error', async () => {
    for (const diagnosticsFail of ['none', 'log', 'screenshot']) {
      let reads = 0
      const f = fixture({
        hierarchy: async () => (reads++ === 0 ? tree() : { children: [] }),
      })
      f.io.screenshot = async (stage) => {
        f.events.push(`private ${stage} screenshot`)
        if (diagnosticsFail === 'screenshot' && stage === 'after')
          throw new Error('screenshot_failed')
      }
      f.io.recordLog = async () => {
        f.events.push('private log')
        if (diagnosticsFail === 'log') throw new Error('log_failed')
      }
      await assert.rejects(
        proveReleaseLiveFont(configuration(), f.io),
        /release_production_preview_required/
      )
      assert.ok(f.events.indexOf('private log') > f.events.indexOf('private after'))
      assert.ok(
        f.events.indexOf('private after screenshot') <
          f.events.lastIndexOf(`am force-stop ${app}`)
      )
      assert.equal(f.events.at(-1), 'settings put system font_scale 1.2')
    }
  })
})

describe('Release live-font applied configuration window', () => {
  for (const [name, dump] of [
    ['old app configuration', activityDump({ scale: '1.0' })],
    ['another app only', activityDump({ component: 'com.other.app' })],
    ['paused app configuration', activityDump({ resumed: false })],
    ['global configuration only', 'mGlobalConfig={1.5 420dpi}'],
  ]) {
    test(`preserved pre-recreation hierarchy cannot pass with ${name}`, async () => {
      const f = fixture()
      const shell = f.io.shell
      f.io.shell = (args) =>
        args.join(' ') === 'dumpsys activity top -a' ? dump : shell(args)
      await assert.rejects(
        proveReleaseLiveFont(configuration(), f.io),
        /release_applied_font_configuration_required/
      )
      assert.equal(f.now(), RESTORE_DEADLINE_MS)
    })
  }

  test('applied app configuration and two preserved states must span the stable observation window', async () => {
    const f = fixture()
    const shell = f.io.shell
    let observed = 0
    let afterReads = 0
    f.io.shell = (args) => {
      if (args.join(' ') === 'dumpsys activity top -a') {
        observed++
        return activityDump()
      }
      return shell(args)
    }
    f.io.hierarchy = async (_timeout, stage) => {
      if (stage === 'after') {
        afterReads++
        assert.ok(observed > 0)
      }
      return tree()
    }
    assert.equal((await proveReleaseLiveFont(configuration(), f.io)).passed, true)
    assert.ok(afterReads >= 2)
    assert.ok(f.now() >= STABLE_WINDOW_MS)
    assert.ok(observed >= afterReads * 2)
  })

  test('a delayed recreation after the first valid snapshot still fails state preservation', async () => {
    const f = fixture()
    const shell = f.io.shell
    f.io.shell = (args) =>
      args.join(' ') === 'dumpsys activity top -a' ? activityDump() : shell(args)
    let afterReads = 0
    f.io.hierarchy = async (_timeout, stage) =>
      stage === 'after' && afterReads++ > 0 ? { children: [] } : tree()
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_production_preview_required/
    )
  })

  test('configuration changing during capture cannot establish restored state', async () => {
    const f = fixture()
    const shell = f.io.shell
    let queries = 0
    f.io.shell = (args) =>
      args.join(' ') === 'dumpsys activity top -a'
        ? activityDump({ scale: ++queries % 2 ? '1.5' : '1.0' })
        : shell(args)
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_applied_font_configuration_required/
    )
    assert.equal(f.now(), RESTORE_DEADLINE_MS)
  })

  test('replacement Activity must establish its own stable observation window', async () => {
    const f = fixture()
    const shell = f.io.shell
    let queries = 0
    f.io.shell = (args) =>
      args.join(' ') === 'dumpsys activity top -a'
        ? activityDump({ token: ++queries <= 2 ? 'old' : 'new' })
        : shell(args)
    assert.equal((await proveReleaseLiveFont(configuration(), f.io)).passed, true)
    // The old Activity opens one window; its replacement must open and hold a second.
    assert.ok(f.now() >= 2 * STABLE_WINDOW_MS)
  })

  test('a first preserved state too late for a stable window cannot report applied-configuration success', async () => {
    const f = fixture()
    f.io.hierarchy = async (_timeout, stage) => {
      // Half a stable window before the deadline leaves too little time to hold it.
      if (stage === 'after') await f.io.pause(RESTORE_DEADLINE_MS - STABLE_WINDOW_MS / 2)
      return tree()
    }
    await assert.rejects(
      proveReleaseLiveFont(configuration(), f.io),
      /release_stable_state_required/
    )
    assert.equal(f.now(), RESTORE_DEADLINE_MS)
  })
})
