// Production follow-up after the project close (2026-11-19): Use my location on web.
//
// Asks the browser for the device position only when the member taps the action, at low
// accuracy, and rounds it to two decimals (about 1 km) before anything else sees it. The
// precise position never leaves this module: no log, no analytics, no URL.
'use client'

/** Why no position: the member or browser refused, or the browser could not tell. */
export type DevicePositionFailure = 'denied' | 'unavailable'

export class DevicePositionError extends Error {
  readonly reason: DevicePositionFailure

  constructor(reason: DevicePositionFailure) {
    super(reason === 'denied' ? 'Location access is off.' : 'Location is unavailable.')
    this.name = 'DevicePositionError'
    this.reason = reason
  }
}

/** The browser gets this long to answer once permission is granted. */
export const DEVICE_POSITION_TIMEOUT_MS = 10_000
/**
 * Some browsers never answer when the member dismisses the permission prompt. Past this,
 * the request reads as unavailable and a late answer is ignored.
 */
export const DEVICE_POSITION_GIVE_UP_MS = 60_000
/** A position this recent is close enough for a city. */
const DEVICE_POSITION_MAX_AGE_MS = 10 * 60_000
/** `GeolocationPositionError.PERMISSION_DENIED`, which jsdom does not define. */
const PERMISSION_DENIED = 1

export interface ApproximatePosition {
  latitude: number
  longitude: number
}

/** Two decimals, about a kilometre: all a city lookup needs. */
export function approximateCoordinate(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

/** The device position rounded to two decimals, or a `DevicePositionError`. */
export function readApproximatePosition(): Promise<ApproximatePosition> {
  const geolocation =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator.geolocation as Geolocation | undefined)
  if (!geolocation) return Promise.reject(new DevicePositionError('unavailable'))

  return new Promise((resolve, reject) => {
    let done = false
    const finish = (settle: () => void) => {
      if (done) return
      done = true
      clearTimeout(giveUp)
      settle()
    }
    const giveUp = setTimeout(
      () => finish(() => reject(new DevicePositionError('unavailable'))),
      DEVICE_POSITION_GIVE_UP_MS
    )
    try {
      geolocation.getCurrentPosition(
        (position) =>
          finish(() =>
            resolve({
              latitude: approximateCoordinate(position.coords.latitude),
              longitude: approximateCoordinate(position.coords.longitude),
            })
          ),
        (error) =>
          finish(() =>
            reject(
              new DevicePositionError(
                error.code === PERMISSION_DENIED ? 'denied' : 'unavailable'
              )
            )
          ),
        {
          enableHighAccuracy: false,
          timeout: DEVICE_POSITION_TIMEOUT_MS,
          maximumAge: DEVICE_POSITION_MAX_AGE_MS,
        }
      )
    } catch {
      finish(() => reject(new DevicePositionError('unavailable')))
    }
  })
}
