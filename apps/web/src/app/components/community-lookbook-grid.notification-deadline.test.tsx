// Story 6.5: a notification target's first attempt always dispatches, and no retry
// starts once it could no longer answer inside the operation's 10 s bound.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  POST_PATH,
  item,
  renderGrid,
  setupCommunityGridClock,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()
const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  window.sessionStorage.clear()
  signIn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  window.history.replaceState(
    null,
    '',
    '/community?source=notification&type=community&cardId=post-1&commentId=reply-1&parentId=root-1'
  )
})
afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
  if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

function useNotificationAttempts(status: 200 | 503) {
  const starts: number[] = []
  // Attempts are timed where the client sends them. The mock server sees a request only
  // after any response delay the run injects, which would shift the later attempts.
  const send = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (
      url.endsWith('/api/v1/community/targets/resolve') &&
      typeof init?.body === 'string' &&
      init.body.includes('"key":"notification"')
    )
      starts.push(performance.now())
    return send(input, init)
  })
  useMswHandlers(
    http.get(POST_PATH, () => HttpResponse.json({ data: item() })),
    http.post('/api/v1/community/targets/resolve', async ({ request }) => {
      const body = (await request.json()) as { targets: { key: string }[] }
      if (status === 503)
        return HttpResponse.json(
          { statusCode: 503, error: 'Service Unavailable', message: 'Unavailable' },
          { status: 503 }
        )
      return HttpResponse.json({
        data: {
          targets: body.targets.map((target) => ({
            key: target.key,
            status: 'unavailable',
          })),
        },
      })
    })
  )
  return starts
}

it('dispatches the first notification target attempt as soon as the grid opens', async () => {
  const starts = useNotificationAttempts(200)
  const opened = performance.now()
  renderGrid({ highlightedCardId: 'post-1' })
  await waitFor(() => expect(starts.length).toBeGreaterThan(0))
  expect(starts[0]! - opened).toBeLessThan(2000)
})

it('starts no retry that could not answer inside the 10 s bound', async () => {
  const starts = useNotificationAttempts(503)
  renderGrid({ highlightedCardId: 'post-1' })
  await waitFor(() => expect(starts.length).toBeGreaterThan(0))
  // Let the whole bounded operation run out, then a little longer.
  await new Promise((resolve) => setTimeout(resolve, 10_500))
  expect(starts.length).toBeGreaterThan(1)
  // Every attempt left with at least the minimum attempt window still on the clock.
  expect(starts.at(-1)! - starts[0]!).toBeLessThanOrEqual(10_000 - 250)
  await waitFor(() =>
    expect(
      screen.getByText('Community is temporarily unavailable. Your draft is saved.')
    ).toBeVisible()
  )
}, 20_000)
