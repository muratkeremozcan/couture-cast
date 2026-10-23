/**
 * Story 1.2b R24: the runner endpoint Android flows open Expo Go deep links
 * through, so every launch carries the extra that turns Expo Go's developer-menu
 * onboarding off. See scripts/lib/expo-go-link-endpoint.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DISABLE_ONBOARDING_EXTRA,
  expoGoOpenLinkArgs,
  listAdbDevices,
  startExpoGoLinkEndpoint,
} from '../../../scripts/lib/expo-go-link-endpoint.mjs'

const LINK = 'exp://127.0.0.1:8081/--/(tabs)?source=widget&size=small'
let close: (() => Promise<void>) | undefined

afterEach(async () => {
  await close?.()
  close = undefined
})

async function endpoint(
  run = vi.fn(() => Promise.resolve({ code: 0, output: 'Status: ok' })),
  disableOnboarding = true
) {
  const started = await startExpoGoLinkEndpoint({
    adbBinary: '/sdk/adb',
    devices: ['emulator-5554', 'emulator-5556'],
    disableOnboarding,
    run,
  })
  close = started.close
  const post = (body: unknown) =>
    fetch(started.url, { method: 'POST', body: JSON.stringify(body) })
  return { run, post, url: started.url }
}

describe('Expo Go link endpoint', () => {
  it('1.2b-R24-01 opens the link on the asking device with onboarding off', async () => {
    const { run, post } = await endpoint()

    const response = await post({ device: 'emulator-5556', url: LINK })

    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      '/sdk/adb',
      [
        '-s',
        'emulator-5556',
        'shell',
        'am',
        'start',
        '-W',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        `'${LINK}'`,
        '--ez',
        DISABLE_ONBOARDING_EXTRA,
        'true',
        'host.exp.exponent',
      ],
      expect.any(AbortSignal)
    )
  })

  it('1.2b-R24-02 leaves the extra off when the run keeps Expo Go defaults', () => {
    expect(
      expoGoOpenLinkArgs('emulator-5554', LINK, { disableOnboarding: false })
    ).not.toContain(DISABLE_ONBOARDING_EXTRA)
  })

  it('1.2b-R24-03 quotes a single quote for the device shell', () => {
    expect(expoGoOpenLinkArgs('emulator-5554', "exp://host/--/a'b")[9]).toBe(
      "'exp://host/--/a'\\''b'"
    )
  })

  it.each([
    ['an unknown device', { device: 'emulator-9999', url: LINK }, 400],
    [
      'a link outside Expo Go',
      { device: 'emulator-5554', url: 'https://evil.example' },
      400,
    ],
    ['a body that is not JSON', 'not json', 400],
  ])('1.2b-R24-04 refuses %s without running adb', async (_name, body, status) => {
    const { run, url } = await endpoint()

    const response = await fetch(url, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

    expect(response.status).toBe(status)
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    ['adb exits non-zero', { code: 1, output: 'device offline' }],
    // `am start` reports a refused intent on stdout and still exits 0.
    ['am start reports an error', { code: 0, output: 'Error: Activity not started' }],
  ])('1.2b-R24-05 answers 502 when %s', async (_name, result) => {
    const { post } = await endpoint(vi.fn(() => Promise.resolve(result)))

    const response = await post({ device: 'emulator-5554', url: LINK })

    expect(response.status).toBe(502)
    expect(await response.text()).toBe(result.output)
  })

  it('1.2b-R24-06 lists only devices adb reports ready', async () => {
    const run = vi.fn(() =>
      Promise.resolve({
        code: 0,
        output:
          'List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n\n',
      })
    )

    await expect(listAdbDevices('/sdk/adb', run)).resolves.toEqual(['emulator-5554'])
  })
  it('1.2b-R24-07 answers 504 naming the device and command when adb hangs', async () => {
    let received: AbortSignal | undefined
    const hangs = vi.fn(
      (_binary: string, _args: string[], signal?: AbortSignal) =>
        new Promise<{ code: number | null; output: string }>(() => {
          received = signal
        })
    )
    const started = await startExpoGoLinkEndpoint({
      adbBinary: '/sdk/adb',
      devices: ['emulator-5554'],
      timeoutMs: 50,
      run: hangs,
    })
    close = started.close

    const response = await fetch(started.url, {
      method: 'POST',
      body: JSON.stringify({ device: 'emulator-5554', url: LINK }),
    })

    expect(response.status).toBe(504)
    const body = await response.text()
    expect(body).toContain('emulator-5554')
    expect(body).toContain('/sdk/adb -s emulator-5554 shell am start -W')
    expect(received?.aborted).toBe(true)
  })

  it('1.2b-R24-08 kills a real adb process that outlives the timeout', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-go-link-'))
    const pidFile = path.join(directory, 'pid')
    const stuckAdb = path.join(directory, 'adb')
    fs.writeFileSync(stuckAdb, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`, {
      mode: 0o755,
    })
    try {
      const started = await startExpoGoLinkEndpoint({
        adbBinary: stuckAdb,
        devices: ['emulator-5554'],
        timeoutMs: 300,
      })
      close = started.close

      const response = await fetch(started.url, {
        method: 'POST',
        body: JSON.stringify({ device: 'emulator-5554', url: LINK }),
      })

      expect(response.status).toBe(504)
      const pid = Number(fs.readFileSync(pidFile, 'utf8'))
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
