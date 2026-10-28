import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { UserCacheHeadersMiddleware } from './user-cache-headers.middleware.js'

describe('UserCacheHeadersMiddleware', () => {
  it('sets a private no-store policy before continuing the chain', () => {
    const setHeader = vi.fn()
    const next = vi.fn()
    new UserCacheHeadersMiddleware().use(
      {} as Request,
      { setHeader } as unknown as Response,
      next as unknown as NextFunction
    )
    expect(setHeader).toHaveBeenCalledExactlyOnceWith(
      'Cache-Control',
      'private, no-store'
    )
    expect(setHeader.mock.invocationCallOrder[0]).toBeLessThan(
      next.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
    expect(next).toHaveBeenCalledTimes(1)
  })
})
