// Story 6.3 cache-header owner: mark every community response private and vary it in `apps/api/src/modules/community/community-cache-headers.middleware.ts`
import type { NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

/** Reaction choices and exact counts must stay private on successes and refusals. */
export class CommunityCacheHeadersMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    response.setHeader('Cache-Control', 'private, no-store')
    response.vary('x-couture-reactions')
    response.vary('x-couture-sponsorship')
    response.vary('x-couture-platform')
    response.vary('Authorization')
    next()
  }
}
