import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

/**
 * `/api/v1` responses belong to the bearer's account or carry per-viewer state.
 * Without a policy the browser keeps them under the URL alone and revalidates them
 * with Express's body-derived ETag across an account switch in the same profile, so
 * none is stored. Middleware sets the header before any guard or handler can throw.
 */
@Injectable()
export class ApiCacheHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'private, no-store')
    next()
  }
}
