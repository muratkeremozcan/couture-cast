import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { CommerceCacheHeadersMiddleware } from './commerce-cache-headers.middleware.js'

describe('CommerceCacheHeadersMiddleware', () => {
  it('sets a private no-store policy and continues the chain', () => {
    const setHeader = vi.fn()
    const next = vi.fn()

    new CommerceCacheHeadersMiddleware().use(
      {} as Request,
      { setHeader } as unknown as Response,
      next as unknown as NextFunction
    )

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
    // The header is set BEFORE `next()`, which is the entire reason this is
    // middleware: by the time any handler, guard, or pipe can throw, the header
    // is already on the response object.
    expect(setHeader.mock.invocationCallOrder[0]).toBeLessThan(
      next.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
    expect(next).toHaveBeenCalledTimes(1)
  })
})
