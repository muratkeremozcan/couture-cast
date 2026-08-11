import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

/**
 * Every `/api/v1/commerce` response is user-scoped: a preference read, an
 * attributed click, or an error that reveals which of those a user is entitled
 * to. None of it may be stored by a shared cache.
 *
 * This is middleware rather than a per-handler `@Header` for the reason spelled
 * out at `wardrobe-capsule.controller.ts:33-36`: a header set after the service
 * call is never applied when the service throws, and this feature is mostly
 * throwing paths. The click endpoint alone can answer 403, 404, 500, and 503,
 * and a 503 that a proxy is free to cache would keep the kill switch stuck on
 * long after an operator turned the feature back on.
 */
@Injectable()
export class CommerceCacheHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'private, no-store')
    next()
  }
}
