import fs from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import {
  assertIosReadDenied,
  shouldRetryIosSnapshot,
  assertOwnedStory68AppReset,
  restoreAndroidReverse,
  withNativeTransport,
  assertOwnedStory68EmulatorPort,
} from '../../../scripts/lib/story68-native-safety.mjs'

type Execute = NonNullable<Parameters<typeof restoreAndroidReverse>[0]['execute']>

describe('assertOwnedStory68EmulatorPort', () => {
  it('permits owned emulator console ports only when the adjacent ADB channel stays supported', () => {
    for (const avd of ['cc68-api32', 'cc68-api36'])
      for (let port = 5554; port <= 5584; port += 2)
        expect(() =>
          assertOwnedStory68EmulatorPort({ avd, port: String(port) })
        ).not.toThrow()
  })

  it('rejects out-of-range, odd, malformed and unowned emulator selections', () => {
    for (const port of [
      '5552',
      '5586',
      '5588',
      '5598',
      '5555',
      '5583',
      '05554',
      '5554.0',
      '5554x',
      ' 5554',
      5554,
      undefined,
    ])
      expect(() => assertOwnedStory68EmulatorPort({ avd: 'cc68-api36', port })).toThrow(
        'owned_avd_and_safe_even_port_required'
      )
    for (const avd of ['Pixel_9_Pro_XL', 'cc68-api36-other', undefined])
      expect(() => assertOwnedStory68EmulatorPort({ avd, port: '5584' })).toThrow(
        'owned_avd_and_safe_even_port_required'
      )
  })
})
describe('restoreAndroidReverse inside withNativeTransport', () => {
  const online = { status: 0, stderr: '' }
  const offline = { status: 1, stderr: 'adb: device offline\n' }
  const reverseInput = {
    adb: '/owned/sdk/adb',
    device: 'emulator-5586',
    ports: [4088, 8089],
  }

  it('waits for only the selected offline device and reapplies reverse once without replaying UI', () => {
    const execute = vi.fn<Execute>().mockReturnValue(online).mockReturnValueOnce(offline)
    const ui = vi.fn(() => ({ status: 0 }))
    const restore = () => restoreAndroidReverse({ ...reverseInput, execute })
    expect(withNativeTransport(ui, restore)).toEqual({ status: 0 })
    expect(ui).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      ['-s', 'emulator-5586', 'reverse', 'tcp:4088', 'tcp:4088'],
      ['-s', 'emulator-5586', 'wait-for-device'],
      ['-s', 'emulator-5586', 'reverse', 'tcp:4088', 'tcp:4088'],
      ['-s', 'emulator-5586', 'reverse', 'tcp:8089', 'tcp:8089'],
      ['-s', 'emulator-5586', 'reverse', 'tcp:4088', 'tcp:4088'],
      ['-s', 'emulator-5586', 'reverse', 'tcp:8089', 'tcp:8089'],
    ])
    for (const call of execute.mock.calls)
      expect(call[2]).toMatchObject({ timeout: 10_000, killSignal: 'SIGKILL' })
  })

  it('restores a post-flow offline transport while retaining the one completed UI result', () => {
    const execute = vi
      .fn<Execute>()
      .mockReturnValue(online)
      .mockReturnValueOnce(online)
      .mockReturnValueOnce(online)
      .mockReturnValueOnce(offline)
    const ui = vi.fn(() => ({ status: 0 }))
    withNativeTransport(ui, () => restoreAndroidReverse({ ...reverseInput, execute }))
    expect(ui).toHaveBeenCalledTimes(1)
    expect(
      execute.mock.calls.filter((call) => call[1][2] === 'wait-for-device')
    ).toHaveLength(1)
  })

  it.each([
    {
      status: null,
      stderr: '',
      error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    },
    { status: 1, stderr: 'adb: device offline' },
    { status: 1, stderr: 'adb: device unauthorized' },
  ])('fails a readiness wait with $status/$stderr and never replays UI', (failure) => {
    const execute = vi
      .fn<Execute>()
      .mockReturnValueOnce(offline)
      .mockReturnValueOnce(failure)
    const ui = vi.fn(() => ({ status: 0 }))
    expect(() =>
      withNativeTransport(ui, () => restoreAndroidReverse({ ...reverseInput, execute }))
    ).toThrow('owned_command_failed:adb')
    expect(ui).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each([
    { status: 1, stderr: 'adb: device unauthorized' },
    { status: 1, stderr: 'adb: no devices/emulators found' },
    { status: 1, stderr: 'adb: device offline\nother failure' },
    { status: 2, stderr: 'adb: device offline' },
  ])('keeps unrelated reverse failures fatal without waiting: $stderr', (failure) => {
    const execute = vi.fn<Execute>().mockReturnValue(failure)
    expect(() => restoreAndroidReverse({ ...reverseInput, execute })).toThrow(
      'owned_command_failed:adb'
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('fails a second offline reverse without a second wait', () => {
    const execute = vi
      .fn<Execute>()
      .mockReturnValueOnce(offline)
      .mockReturnValueOnce(online)
      .mockReturnValueOnce(offline)
    expect(() => restoreAndroidReverse({ ...reverseInput, execute })).toThrow(
      'owned_command_failed:adb'
    )
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('preserves a failed Maestro result even when post-flow transport fails or recovers', () => {
    for (const failedTransport of [false, true]) {
      const result = { status: 7, stdout: 'Assertion is false' }
      const ui = vi.fn(() => result)
      const restore = vi
        .fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          if (failedTransport) throw new Error('owned_command_failed:adb')
        })
      expect(withNativeTransport(ui, restore)).toBe(result)
      expect(ui).toHaveBeenCalledTimes(1)
      expect(restore).toHaveBeenCalledTimes(2)
    }
  })
})
describe('assertOwnedStory68AppReset', () => {
  const owned = {
    appId: 'com.couturecast.story68',
    isolatedBuild: '1',
    debuggable: true,
    explicit: 'yes',
  }
  it('permits a deliberate reset of only the isolated, debuggable story application', () => {
    expect(() => assertOwnedStory68AppReset(owned)).not.toThrow()
    for (const input of [
      { ...owned, appId: 'com.couturecast.app' },
      { ...owned, isolatedBuild: '0' },
      { ...owned, debuggable: false },
      { ...owned, explicit: undefined },
    ])
      expect(() => assertOwnedStory68AppReset(input)).toThrow(
        'explicit_owned_story68_app_reinitialization_required'
      )
  })
})

describe('assertIosReadDenied', () => {
  it('requires actual denied read access and the separate add-only grant for original proof', () => {
    expect(() => assertIosReadDenied({ read: 0, addOnly: null })).not.toThrow()
    expect(() => assertIosReadDenied({ read: 0, addOnly: 2 }, true)).not.toThrow()
    for (const state of [
      { read: 2, addOnly: 2 },
      { read: null, addOnly: 2 },
      { read: 0, addOnly: null },
      { read: 0, addOnly: 0 },
    ])
      expect(() => assertIosReadDenied(state, true)).toThrow(
        'ios_read_denied_add_only_evidence_required'
      )
  })
})

describe('shouldRetryIosSnapshot', () => {
  it('retries only the exact stale iOS snapshot once, keeping product assertion failures fatal', () => {
    const exact =
      'Snapshot failure while getting view hierarchy. Error: Error getting element frame kAXErrorInvalidUIElement'
    const flow = 'maestro/story68/community-draft-background-ios.yaml'
    expect(
      shouldRetryIosSnapshot({ platform: 'ios', attempt: 0, log: exact, flow })
    ).toBe(true)
    expect(
      shouldRetryIosSnapshot({
        platform: 'ios',
        attempt: 0,
        flow,
        log:
          '[WARN] ElementNotFound while searching\n[ERROR] ' +
          exact +
          '\n[ERROR] CommandFailed: null',
      })
    ).toBe(true)
    for (const input of [
      { platform: 'android', attempt: 0, log: exact },
      { platform: 'ios', attempt: 1, log: exact },
      { platform: 'ios', attempt: 0, log: exact.replace('InvalidUIElement', 'Other') },
      { platform: 'ios', attempt: 0, log: exact + ' AssertionFailure' },
      { platform: 'ios', attempt: 0, log: 'Assertion is false' },
      {
        platform: 'ios',
        attempt: 0,
        log: exact + '\n[ERROR] CommandFailed: ElementNotFound',
      },
      {
        platform: 'ios',
        attempt: 0,
        log: exact + '\n[ERROR] Unexpected terminal failure',
      },
    ])
      expect(shouldRetryIosSnapshot({ ...input, flow })).toBe(false)
    for (const flow of [
      'maestro/story68/open-outfit.yaml',
      'maestro/story68/open-post.yaml',
      'maestro/story68/cancel.yaml',
    ])
      expect(
        shouldRetryIosSnapshot({ platform: 'ios', attempt: 0, log: exact, flow })
      ).toBe(true)
    for (const flow of [
      'save',
      'import',
      'pending',
      'navigate-pending',
      'watermark',
      'failure',
      'denied',
      'permanent',
    ])
      expect(
        shouldRetryIosSnapshot({
          platform: 'ios',
          attempt: 0,
          log: exact,
          flow: `maestro/story68/${flow}.yaml`,
        })
      ).toBe(false)
  })
})
describe('community-draft-background-ios durable flow', () => {
  it('background foreground recovery preserves OS permissions in the actual durable flow', () => {
    const flow = parse(
      fs
        .readFileSync('maestro/story68/community-draft-background-ios.yaml', 'utf8')
        .split('---\n')[1] ?? ''
    ) as {
      launchApp?: {
        stopApp: boolean
        clearState: boolean
        permissions: Record<string, string>
      }
    }[]
    const launch = flow.find((step) => step.launchApp)?.launchApp
    expect(launch).toMatchObject({ stopApp: false, clearState: false, permissions: {} })
    expect(Object.keys(launch?.permissions ?? {})).toEqual([])
  })
})
