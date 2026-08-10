import { describe, expect, it } from 'vitest'

import { waitForPoll } from './native-utils'

describe('waitForPoll', () => {
  it('resolves once the delay elapses', async () => {
    const controller = new AbortController()

    await expect(waitForPoll(1, controller.signal)).resolves.toBeUndefined()
  })

  /**
   * Every wardrobe poll loop leans on this rejection to stop: without it an
   * unmounted screen keeps polling the API until its schedule runs out.
   */
  it('rejects with POLL_ABORTED as soon as the signal aborts', async () => {
    const controller = new AbortController()
    const pending = waitForPoll(60_000, controller.signal)

    controller.abort()

    await expect(pending).rejects.toThrow('POLL_ABORTED')
  })

  it('rejects immediately for a signal that is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(waitForPoll(60_000, controller.signal)).rejects.toThrow('POLL_ABORTED')
  })
})
