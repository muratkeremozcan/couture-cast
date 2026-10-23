/**
 * Story 1.2b: the one clock the location capture and preference services read.
 *
 * Search rate-limit windows, candidate token expiry, snapshot staleness on a
 * primary change and the refresh job's time bucket all come from it, so a test
 * that provides one controlled clock moves every one of them together.
 */
export const LOCATION_CLOCK = Symbol('LOCATION_CLOCK')

export interface LocationClock {
  now(): Date
}

export const systemLocationClock: LocationClock = {
  now: () => new Date(),
}
