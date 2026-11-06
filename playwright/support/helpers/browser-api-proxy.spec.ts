// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: which proxy failures a test may ignore. The message is the one a real browser gives
// when a context closes with a fetch in flight, measured on 2026-11-05.
import { describe, expect, it } from 'vitest'
import { isAbandonedByClose } from './browser-api-proxy'

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
