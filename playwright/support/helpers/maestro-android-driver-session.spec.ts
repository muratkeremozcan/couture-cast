/**
 * Story 6.7b R18: every Android flow starts its own Maestro driver on a port
 * the device cannot be using, and a session record left by a flow whose driver
 * never started cannot make the next flow attach to that missing driver. See
 * scripts/lib/maestro-android-driver-session.mjs.
 */
import { describe, expect, it } from 'vitest'
import {
  MAESTRO_ANDROID_DRIVER_PORT,
  MAESTRO_SESSION_ACTIVE_MS,
  activeMaestroSessions,
  devicePortHolders,
  waitForDevicePortFree,
  waitForStaleMaestroSessions,
} from '../../../scripts/lib/maestro-android-driver-session.mjs'

const STALE_ID = '2bf03969-81d5-4a18-874e-3cc80ad6fbc7'

/** A clock that each fake sleep advances. */
function fakeClock(start = 1_000_000) {
  let now = start
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms)
      now += ms
      return Promise.resolve()
    },
    sleeps,
  }
}

describe('Maestro session records', () => {
  it('6.7b-R18-16 counts only fresh records of the platform and device, newest first', () => {
    const nowMs = 100_000
    const text = [
      `ANDROID_emulator-5554_${STALE_ID}=${nowMs - 3_000}`,
      `ANDROID_emulator-5554_older=${nowMs - 15_000}`,
      `ANDROID_emulator-5554_expired=${nowMs - MAESTRO_SESSION_ACTIVE_MS}`,
      `ANDROID_emulator-55540_other=${nowMs - 1_000}`,
      `IOS_emulator-5554_ios=${nowMs - 1_000}`,
      'ANDROID_emulator-5554_broken=not-a-number',
      '',
    ].join('\n')
    expect(
      activeMaestroSessions(text, { platform: 'android', device: 'emulator-5554', nowMs })
    ).toEqual([
      { sessionId: STALE_ID, heartbeatMs: nowMs - 3_000, ageMs: 3_000 },
      { sessionId: 'older', heartbeatMs: nowMs - 15_000, ageMs: 15_000 },
    ])
    // adb's single default device: every Android record counts.
    expect(
      activeMaestroSessions(text, { platform: 'ANDROID', nowMs }).map((s) => s.sessionId)
    ).toEqual(['other', STALE_ID, 'older'])
  })

  it('6.7b-R18-17 waits out a record whose invocation exited before its driver started', async () => {
    const clock = fakeClock()
    const heartbeat = clock.now() - 2_000
    const logs: string[] = []
    const result = await waitForStaleMaestroSessions({
      device: 'emulator-5554',
      read: () => `ANDROID_emulator-5554_${STALE_ID}=${heartbeat}\n`,
      log: (message) => logs.push(message),
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(clock.now() - heartbeat).toBeGreaterThanOrEqual(MAESTRO_SESSION_ACTIVE_MS)
    expect(result.waitedMs).toBeLessThanOrEqual(MAESTRO_SESSION_ACTIVE_MS)
    expect(logs).toEqual([
      `Waiting 19 s for the Maestro session record ${STALE_ID} on emulator-5554 to expire: ` +
        'its invocation exited before its driver started, and a new invocation would ' +
        'attach to that missing driver',
    ])
  })

  it('6.7b-R18-18 returns at once when no record is fresh', async () => {
    const clock = fakeClock()
    expect(
      await waitForStaleMaestroSessions({
        device: 'emulator-5554',
        read: () => '',
        log: () => undefined,
        now: clock.now,
        sleep: clock.sleep,
      })
    ).toEqual({ waitedMs: 0 })
    expect(clock.sleeps).toEqual([])
  })

  it('6.7b-R18-19 refuses to start next to a live Maestro whose heartbeat moves', async () => {
    const clock = fakeClock()
    await expect(
      waitForStaleMaestroSessions({
        device: 'emulator-5554',
        // A live session rewrites its heartbeat every 5 s.
        read: () => `ANDROID_emulator-5554_live=${clock.now() - 1_000}\n`,
        log: () => undefined,
        now: clock.now,
        sleep: clock.sleep,
      })
    ).rejects.toThrow(
      'Another Maestro session (live) is live on emulator-5554: its heartbeat is still moving'
    )
  })
})

describe('driver port on the device', () => {
  const hex = MAESTRO_ANDROID_DRIVER_PORT.toString(16).toUpperCase()
  const PROC_NET = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    `   0: 0100007F:${hex} 00000000:0000 0A 00000000:00000000 00:00000000 00000000 10193 0 1 1`,
    `   1: 0100007F:BB6F 0100007F:${hex} 06 00000000:00000000 03:00000E96 00000000     0 0 0 3`,
    `   2: 0100007F:${hex} 0100007F:9B2F 06 00000000:00000000 03:00000DE0 00000000     0 0 0 3`,
    '   3: 0100007F:1F90 0100007F:A113 01 00000000:00000000 00:00000000 00000000  2000 0 2 1',
    '  sl  local_address                         remote_address                        st',
    `   0: 00000000000000000000000000000000:${hex} 00000000000000000000000000000000:0000 0A 0 0 0`,
  ].join('\n')

  it('6.7b-R18-20 lists the sockets bound to the port, skipping TIME_WAIT and remote matches', () => {
    expect(MAESTRO_ANDROID_DRIVER_PORT).toBeLessThan(32_768)
    expect(devicePortHolders(PROC_NET, MAESTRO_ANDROID_DRIVER_PORT)).toEqual([
      `0100007F:${hex} -> 00000000:0000 LISTEN`,
      `00000000000000000000000000000000:${hex} -> 00000000000000000000000000000000:0000 LISTEN`,
    ])
    expect(devicePortHolders(PROC_NET, 41235)).toEqual([])
  })

  it('6.7b-R18-21 waits for a closing socket to clear, then names one that stays', async () => {
    const clock = fakeClock()
    const reads = [PROC_NET, '']
    await waitForDevicePortFree({
      readProcNet: () => Promise.resolve(reads.shift() ?? ''),
      port: MAESTRO_ANDROID_DRIVER_PORT,
      device: 'emulator-5554',
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(clock.sleeps).toEqual([1_000])

    await expect(
      waitForDevicePortFree({
        readProcNet: () => Promise.resolve(PROC_NET),
        port: MAESTRO_ANDROID_DRIVER_PORT,
        device: 'emulator-5554',
        now: clock.now,
        sleep: clock.sleep,
      })
    ).rejects.toThrow(
      `device port ${MAESTRO_ANDROID_DRIVER_PORT} on emulator-5554 is still in use after 10000 ms`
    )
  })
})
