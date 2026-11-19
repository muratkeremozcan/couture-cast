// Production follow-up (2026-11-19): the device side of Use my location.
//
// The member taps Use my location and only then is the system asked for
// when-in-use permission (Android coarse only: app.json blocks fine and
// background location). One low-accuracy fix is read, with a deadline, and
// handed to the caller, which rounds it to two decimals before it leaves the
// phone. Nothing here logs the position or sends it anywhere.
//
// `expo-location` loads on the tap, never with the screen: like expo-image-picker
// (src/lib/community.ts), it reaches a native module, and a static import would
// fail every browser suite that renders Locations.
import type * as LocationModule from 'expo-location'

/** How long the device may take to produce one position before the member is told. */
export const DEVICE_POSITION_TIMEOUT_MS = 15_000

/** `denied`: the member said no (or said no before). `unavailable`: no position came back. */
export type DevicePositionFailure = 'location_denied' | 'location_unavailable'

export class DevicePositionError extends Error {
  readonly reason: DevicePositionFailure

  constructor(reason: DevicePositionFailure) {
    super(
      reason === 'location_denied'
        ? 'Location permission was not granted.'
        : 'No device position is available.'
    )
    this.name = 'DevicePositionError'
    this.reason = reason
  }
}

export interface DevicePosition {
  latitude: number
  longitude: number
}

function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DevicePositionError('location_unavailable')),
      timeoutMs
    )
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/**
 * Asks for when-in-use permission, then reads one position at the lowest
 * accuracy the platform offers. Rejects with a `DevicePositionError` only.
 */
export async function readDevicePosition(
  timeoutMs = DEVICE_POSITION_TIMEOUT_MS
): Promise<DevicePosition> {
  let Location: typeof LocationModule
  let permission: LocationModule.LocationPermissionResponse
  try {
    Location = await import('expo-location')
    permission = await Location.requestForegroundPermissionsAsync()
  } catch {
    throw new DevicePositionError('location_unavailable')
  }
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new DevicePositionError('location_denied')
  }
  try {
    const position = await withDeadline(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }),
      timeoutMs
    )
    const { latitude, longitude } = position.coords
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new DevicePositionError('location_unavailable')
    }
    return { latitude, longitude }
  } catch {
    throw new DevicePositionError('location_unavailable')
  }
}
