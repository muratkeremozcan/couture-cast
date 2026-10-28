import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

/**
 * Every `/api/v1/user` response belongs to the bearer's account. Without a policy
 * the browser keeps it under the URL alone and revalidates it with a body-derived
 * ETag across an account switch in the same profile, so these responses are never
 * stored. Middleware sets the header before any guard or handler can throw.
 */
@Injectable()
export class UserCacheHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'private, no-store')
    next()
  }
}
