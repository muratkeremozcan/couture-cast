import { act } from '@testing-library/react'

/**
 * Runs a synchronous step in an awaited `act` scope, with React's act environment on until
 * React has drained the work the step queued.
 *
 * `await act(() => { step() })` with a synchronous callback goes wrong in two halves:
 * Testing Library turns `IS_REACT_ACT_ENVIRONMENT` back off as soon as the callback returns,
 * while React's awaited act reopens its queue and keeps flushing for another task. An update
 * that lands in that window logs "The current testing environment is not configured to
 * support act(...)". A callback that returns a promise keeps both on the same schedule.
 */
export function actStep(step: () => void): Promise<void> {
  return act(() => {
    step()
    return Promise.resolve()
  })
}
