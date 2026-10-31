// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, test } from 'node:test'

import { withColdAndroidFontScale } from './story68-cold-font-scale.mjs'

function matrixFontBlock() {
  const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
  const start = source.indexOf(
    '  const previousFont =',
    source.indexOf("command === 'matrix'")
  )
  // The large-text section is one shard-gated block; the slice stops before its closing brace.
  const end = source.indexOf(
    "\n  }\n  if (\n    inMatrixSection(shard, 'precommit-lifecycle')",
    start
  )
  assert.ok(start > 0 && end > start)
  return source.slice(start, end)
}

function fixture({ previous = '1.1', fault = () => undefined } = {}) {
  const events = []
  const config = {
    appId: 'com.couturecast.story68',
    adb: '/owned/sdk/platform-tools/adb',
    device: 'emulator-5584',
    run: async (binary, args) => {
      assert.equal(binary, '/owned/sdk/platform-tools/adb')
      assert.deepEqual(args.slice(0, 2), ['-s', 'emulator-5584'])
      const event = args.slice(2).join(' ')
      events.push(event)
      fault(event, events)
      return event.includes(' get ') ? `${previous}\n` : ''
    },
    openUrl: async (url) => {
      const event = `url ${url}`
      events.push(event)
      fault(event, events)
    },
    maestro: async (flow) => {
      const event = `flow ${flow}`
      events.push(event)
      fault(event, events)
    },
  }
  return { config, events }
}

const stop = 'shell am force-stop com.couturecast.story68'

const settle = 'flow maestro/story65/open-app.yaml'

describe('withColdAndroidFontScale', () => {
  test('actual Android large-text matrix stops before changing and restoring font, then settles both relaunches', async () => {
    const events = []
    await vm.runInNewContext(`(async () => {${matrixFontBlock()}})()`, {
      platform: 'android',
      adb: '/owned/sdk/platform-tools/adb',
      device: 'emulator-5584',
      appId: 'com.couturecast.story68',
      withColdAndroidFontScale,
      run: (_binary, args) => {
        const rest = args.slice(2)
        events.push(rest.join(' '))
        return rest.includes('get') ? '1.1\n' : ''
      },
      openUrl: (url) => events.push(`url ${url}`),
      maestro: (flow) => events.push(`flow ${flow}`),
      open: (source) => events.push(`open ${source}`),
      close: () => events.push('close'),
      screenshot: (name) => events.push(`screenshot ${name}`),
      mark: (name) => events.push(`mark ${name}`),
    })
    assert.deepEqual(events, [
      'shell settings get system font_scale',
      'shell am force-stop com.couturecast.story68',
      'shell settings put system font_scale 1.5',
      'url couturecast-story68://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8089',
      'flow maestro/story65/open-app.yaml',
      'open outfit',
      'flow maestro/story68/large-text.yaml',
      'screenshot large-text',
      'close',
      'mark M-A11Y:large-text-pt-PT',
      'shell am force-stop com.couturecast.story68',
      'shell settings put system font_scale 1.1',
      'url couturecast-story68://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8089',
      'flow maestro/story65/open-app.yaml',
    ])
  })

  test('an absent original font setting is deleted only after stopping the owned app', async () => {
    const f = fixture({ previous: 'null' })
    const result = await withColdAndroidFontScale(f.config, async () => 'verified')
    assert.equal(result, 'verified')
    const restored = f.events.indexOf('shell settings delete system font_scale')
    assert.equal(f.events[restored - 1], stop)
    assert.match(f.events[restored + 1], /^url couturecast-story68:/)
    assert.equal(f.events[restored + 2], settle)
  })

  test('a failing matrix assertion restores and settles the original font while preserving its error', async () => {
    const f = fixture()
    const original = new Error('actual_large_text_assertion_failed')
    await assert.rejects(
      withColdAndroidFontScale(f.config, async () => {
        assert.equal(f.events.at(-1), settle)
        throw original
      }),
      (error) => error === original
    )
    assert.equal(f.events.at(-4), stop)
    assert.equal(f.events.at(-3), 'shell settings put system font_scale 1.1')
    assert.match(f.events.at(-2), /^url couturecast-story68:/)
    assert.equal(f.events.at(-1), settle)
  })

  for (const failedAt of ['shell settings put system font_scale 1.5', settle]) {
    test(`setup failure at ${failedAt} still restores before returning and never starts assertions`, async () => {
      const original = new Error('setup_acknowledgement_failed')
      let failed = false
      const f = fixture({
        fault: (event) => {
          if (!failed && event === failedAt) {
            failed = true
            throw original
          }
        },
      })
      let verified = false
      await assert.rejects(
        withColdAndroidFontScale(f.config, () => (verified = true)),
        (error) => error === original
      )
      assert.equal(verified, false)
      assert.equal(f.events.at(-4), stop)
      assert.equal(f.events.at(-3), 'shell settings put system font_scale 1.1')
      assert.equal(f.events.at(-1), settle)
    })
  }

  test('cleanup stop failure prevents a hot restore and retains both the proof and cleanup errors', async () => {
    const original = new Error('matrix_assertion_failed')
    const cleanup = new Error('cannot_stop_owned_app')
    const f = fixture({
      fault: (event, events) => {
        if (event === stop && events.filter((item) => item === stop).length === 2)
          throw cleanup
      },
    })
    await assert.rejects(
      withColdAndroidFontScale(f.config, () => {
        throw original
      }),
      (error) => {
        assert.equal(error.message, 'android_font_scale_restore_failed')
        assert.deepEqual(error.errors, [original, cleanup])
        return true
      }
    )
    assert.equal(f.events.at(-1), stop)
    assert.equal(f.events.includes('shell settings put system font_scale 1.1'), false)
  })

  test('a failed initial stop leaves font settings untouched', async () => {
    const original = new Error('cannot_stop_owned_app')
    const f = fixture({
      fault: (event) => {
        if (event === stop) throw original
      },
    })
    await assert.rejects(
      withColdAndroidFontScale(f.config, () =>
        assert.fail('must stop before assertions')
      ),
      (error) => error === original
    )
    assert.deepEqual(f.events, ['shell settings get system font_scale', stop])
  })

  test('the helper rejects an unrelated app or missing explicit device before any command', async () => {
    for (const change of [{ appId: 'com.other.app' }, { device: '' }, { adb: '' }]) {
      const f = fixture()
      await assert.rejects(
        withColdAndroidFontScale({ ...f.config, ...change }, () => assert.fail()),
        /owned_android_font_scale_target_required/
      )
      assert.deepEqual(f.events, [])
    }
  })

  test('asynchronous matrix assertions settle before restoration starts', async () => {
    const f = fixture()
    let release
    let started
    const workStarted = new Promise((resolve) => (started = resolve))
    const pending = withColdAndroidFontScale(f.config, async () => {
      started()
      await new Promise((resolve) => (release = resolve))
      f.events.push('assertions complete')
    })
    await workStarted
    assert.equal(f.events.filter((event) => event === stop).length, 1)
    release()
    await pending
    assert.equal(f.events[f.events.indexOf('assertions complete') + 1], stop)
  })

  test('actual iOS large-text matrix preserves original commands, assertions and finally restoration', async () => {
    for (const failAssertion of [false, true]) {
      const events = []
      const original = new Error('large_text_assertion_failed')
      const execution = vm.runInNewContext(`(async () => {${matrixFontBlock()}})()`, {
        platform: 'ios',
        device: 'owned-ios-uuid',
        withColdAndroidFontScale: () =>
          assert.fail('iOS must preserve its existing setup'),
        run: (binary, args) => {
          assert.equal(binary, 'xcrun')
          events.push(Array.from(args).join(' '))
          return 'large\n'
        },
        open: (source) => events.push(`open ${source}`),
        maestro: (flow) => {
          events.push(`flow ${flow}`)
          if (failAssertion) throw original
        },
        close: () => events.push('close'),
        screenshot: (name) => events.push(`screenshot ${name}`),
        mark: (name) => events.push(`mark ${name}`),
      })
      if (failAssertion) await assert.rejects(execution, (error) => error === original)
      else await execution
      assert.deepEqual(events, [
        'simctl ui owned-ios-uuid content_size',
        'simctl ui owned-ios-uuid content_size accessibility-medium',
        'open outfit',
        'flow maestro/story68/large-text.yaml',
        ...(failAssertion
          ? []
          : ['screenshot large-text', 'close', 'mark M-A11Y:large-text-pt-PT']),
        'simctl ui owned-ios-uuid content_size large',
      ])
    }
  })
})
