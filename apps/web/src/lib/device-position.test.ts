// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19): the web position reader behind
// Use my location. It rounds before anything else sees the position and never waits forever on a
// browser that does not answer a dismissed permission prompt.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  approximateCoordinate,
  DEVICE_POSITION_GIVE_UP_MS,
  DevicePositionError,
  readApproximatePosition,
} from './device-position'

function installGeolocation(getCurrentPosition: Geolocation['getCurrentPosition']) {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  })
}

describe('device position', () => {
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window.navigator, 'geolocation')
  })

  it.each([
    [41.878113, 41.88],
    [-87.629799, -87.63],
    [0.004, 0],
    [-0.004, 0],
    [89.999, 90],
  ])('LOC-POS-WEB-01 rounds %s to %s', (value, expected) => {
    expect(Object.is(approximateCoordinate(value), expected)).toBe(true)
  })

  it('LOC-POS-WEB-02 answers the rounded position, never the precise one', async () => {
    installGeolocation((success) =>
      success({
        coords: { latitude: 41.878113, longitude: -87.629799 },
      } as GeolocationPosition)
    )

    await expect(readApproximatePosition()).resolves.toEqual({
      latitude: 41.88,
      longitude: -87.63,
    })
  })

  it('LOC-POS-WEB-03 gives up on a browser that never answers and ignores a late answer', async () => {
    vi.useFakeTimers()
    let late: PositionCallback | undefined
    installGeolocation((success) => {
      late = success
    })

    const reading = readApproximatePosition().catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(DEVICE_POSITION_GIVE_UP_MS)
    late?.({ coords: { latitude: 1, longitude: 1 } } as GeolocationPosition)

    const failure = await reading
    expect(failure).toBeInstanceOf(DevicePositionError)
    expect((failure as DevicePositionError).reason).toBe('unavailable')
  })

  it('LOC-POS-WEB-04 reads a throwing geolocation as unavailable', async () => {
    installGeolocation(() => {
      throw new Error('insecure context')
    })

    await expect(readApproximatePosition()).rejects.toMatchObject({
      reason: 'unavailable',
    })
  })
})
