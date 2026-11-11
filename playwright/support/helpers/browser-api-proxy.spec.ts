// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: which proxy failures a test may ignore. The message is the one a real browser gives
// when a context closes with a fetch in flight, measured on 2026-11-05.
import type { Page, TestInfo } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import {
  drainApiProxy,
  installApiProxy,
  isAbandonedByClose,
  isAbandonedByPage,
} from './browser-api-proxy'

const DISPOSED = new Error('route.fetch: Request context disposed.')
const page = (closed: boolean) => ({ isClosed: () => closed })

describe('isAbandonedByClose', () => {
  it('ignores the disposal of a fetch on a page that closed', () => {
    expect(isAbandonedByClose(DISPOSED, page(true))).toBe(true)
    // Preview CI, P-D-DISABLED: the context closed between the fetch and reading its body.
    expect(
      isAbandonedByClose(
        new Error('apiResponse.text: Response has been disposed'),
        page(true)
      )
    ).toBe(true)
    expect(
      isAbandonedByClose(
        new Error('route.fulfill: Target page, context or browser has been closed'),
        page(true)
      )
    ).toBe(true)
  })

  it('keeps the same message on a page still open, because then something else disposed it', () => {
    expect(isAbandonedByClose(DISPOSED, page(false))).toBe(false)
  })

  it('keeps every other failure on a closed page', () => {
    expect(isAbandonedByClose(new Error('connect ECONNREFUSED'), page(true))).toBe(false)
    expect(isAbandonedByClose('Request context disposed', page(true))).toBe(false)
  })
})

describe('isAbandonedByPage', () => {
  const HANDLED = new Error('route.fulfill: Route is already handled!')
  /** A request whose failure arrives `lateMs` after the fulfill failed, as on preview. */
  const request = (errorText?: string, lateMs = 0) => {
    let failure: { errorText: string } | null = null
    const settled = new Promise<null>((resolve) =>
      setTimeout(() => {
        if (errorText !== undefined) failure = { errorText }
        resolve(null)
      }, lateMs)
    )
    return {
      failure: () => failure,
      response: () =>
        errorText === undefined ? new Promise<null>(() => undefined) : settled,
    }
  }

  it('ignores a fulfill the page made moot by aborting the request, also when the failure lands later', async () => {
    // Preview, P-D-PREVIEW-CLOSED: the click into a case aborts the queue's availability read.
    expect(await isAbandonedByPage(HANDLED, request('net::ERR_ABORTED'))).toBe(true)
    expect(await isAbandonedByPage(HANDLED, request('net::ERR_ABORTED', 20))).toBe(true)
    expect(await isAbandonedByPage(HANDLED, request('NS_BINDING_ABORTED'))).toBe(true)
  })

  it('keeps a double handling the page did not cause, and every other failure', async () => {
    expect(await isAbandonedByPage(HANDLED, request(undefined), 20)).toBe(false)
    expect(await isAbandonedByPage(HANDLED, request('net::ERR_CONNECTION_REFUSED'))).toBe(
      false
    )
    expect(
      await isAbandonedByPage(
        new Error('connect ECONNREFUSED'),
        request('net::ERR_ABORTED')
      )
    ).toBe(false)
    expect(
      await isAbandonedByPage('Route is already handled!', request('net::ERR_ABORTED'))
    ).toBe(false)
  })
})

describe('drainApiProxy', () => {
  const fakePage = (closed = false) =>
    ({
      isClosed: () => closed,
      route: vi.fn().mockResolvedValue(undefined),
      unrouteAll: vi.fn().mockResolvedValue(undefined),
    }) as unknown as Page & { unrouteAll: ReturnType<typeof vi.fn> }
  const info = {
    project: { use: {}, metadata: { apiBaseUrl: 'http://api.test' } },
    config: { metadata: { apiBaseUrl: 'http://api.test' } },
  } as unknown as TestInfo

  it('waits for what is in flight on a proxied page', async () => {
    const page = fakePage()
    await installApiProxy(page, info)
    await drainApiProxy(page)
    expect(page.unrouteAll).toHaveBeenCalledWith({ behavior: 'wait' })
  })

  it('lets a proxied call finish before it unroutes, and swallows a route teardown sent on', async () => {
    const page = fakePage()
    await installApiProxy(page, info)
    const handler = (page.route as ReturnType<typeof vi.fn>).mock.calls[0]![1] as (
      route: unknown
    ) => Promise<void>
    let answer!: (response: unknown) => void
    const fulfilled: string[] = []
    const route = {
      request: () => ({
        method: () => 'GET',
        url: () => 'https://web.test/api/v1/moderation/evidence-exports/availability',
        headers: () => ({}),
        failure: () => null,
        response: () => new Promise(() => undefined),
      }),
      fetch: () => new Promise((resolve) => (answer = resolve)),
      fulfill: vi.fn(() => {
        // Preview: unrouteAll has already sent this route on, so the fulfill finds it handled.
        if (page.unrouteAll.mock.calls.length)
          return Promise.reject(new Error('route.fulfill: Route is already handled!'))
        fulfilled.push('fulfilled')
        return Promise.resolve()
      }),
    }
    const proxied = handler(route)
    const drained = drainApiProxy(page)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(page.unrouteAll).not.toHaveBeenCalled()
    answer({ text: () => Promise.resolve('{}'), headers: () => ({}), status: () => 200 })
    await Promise.all([proxied, drained])
    expect(fulfilled).toEqual(['fulfilled'])
    expect(page.unrouteAll).toHaveBeenCalledWith({ behavior: 'wait' })

    // A call that starts after the wait and loses its route to the unroute is not a test failure.
    const late = handler(route)
    answer({ text: () => Promise.resolve('{}'), headers: () => ({}), status: () => 200 })
    await expect(late).resolves.toBeUndefined()
  })

  it('leaves a page with no proxy, and a closed page, alone', async () => {
    const plain = fakePage()
    await drainApiProxy(plain)
    expect(plain.unrouteAll).not.toHaveBeenCalled()
    const closed = fakePage(true)
    await installApiProxy(closed, info)
    await drainApiProxy(closed)
    expect(closed.unrouteAll).not.toHaveBeenCalled()
  })
})
