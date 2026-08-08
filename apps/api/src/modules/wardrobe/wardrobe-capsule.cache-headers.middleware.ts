import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

/**
 * Capsule responses carry private wardrobe data, so every one of them must be
 * uncacheable, including error responses.
 *
 * This runs as middleware rather than inside the handlers because a header set
 * after the service call is never applied when the service throws. Middleware
 * runs before guards, validation, and the handler, so the header is already on
 * the response object no matter which layer produces the status.
 */
@Injectable()
export class CapsuleCacheHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'private, no-store')
    next()
  }
}
