import { act } from '@testing-library/react'
import { beforeEach, vi, type MockInstance } from 'vitest'

/**
 * A barrier for "this request never started", read from evidence instead of elapsed time. Every
 * request is recorded where the client starts it (the fetch boundary), so a duplicate read that
 * starts late is seen the moment it starts, and `settle` does not return until the count of
 * started requests has stopped moving. A request a test holds on purpose is not waited for.
 *
 * Importing this module installs the recorder before each test of the importing file.
 */
let fetchSpy: MockInstance<typeof fetch> | undefined

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

/** How many requests the client has started in this test. */
export const requestsStarted = () => fetchSpy?.mock.calls.length ?? 0

const FLOOR = 3
const QUIET_ROUNDS = 2
const CEILING = 25

/**
 * Lets pending reads answer and React apply them. At least three rounds, then rounds continue
 * until two in a row start no request; a request that starts in a round restarts the count, so
 * its handler is reached before the caller asserts on what the handlers saw.
 */
export async function settle() {
  let quiet = 0
  for (
    let round = 0;
    round < CEILING && (round < FLOOR || quiet < QUIET_ROUNDS);
    round += 1
  ) {
    const before = requestsStarted()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    quiet = requestsStarted() === before ? quiet + 1 : 0
  }
}
