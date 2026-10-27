import { act } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { drainMacrotask } from './drain-macrotask'

/**
 * Records every JSON body the app reads from a URL containing `urlPart`, so a test can
 * wait for a held MSW response to actually reach the app before a negative assertion.
 * `restoreMocks` in vitest.config.ts removes the spy after each test.
 */
export function trackJsonBodies(urlPart: string) {
  const readJson = Object.getOwnPropertyDescriptor(Response.prototype, 'json')!.value as (
    this: Response
  ) => Promise<unknown>
  const bodies: Promise<unknown>[] = []
  vi.spyOn(Response.prototype, 'json').mockImplementation(function (this: Response) {
    const body = readJson.call(this)
    if (this.url.includes(urlPart)) bodies.push(body)
    return body
  })
  return {
    /** Waits until `count` bodies were read, then one macrotask so every microtask chained
     * to them (parsing, generation and identity checks, state updates) has run. */
    async settled(count = 1) {
      await vi.waitFor(() => expect(bodies).toHaveLength(count))
      await act(async () => {
        await Promise.allSettled(bodies)
        await drainMacrotask()
      })
    },
  }
}
