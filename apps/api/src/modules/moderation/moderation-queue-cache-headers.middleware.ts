// Story 6.10 cache-header owner: mark every queue and case response private, success or refusal, in `apps/api/src/modules/moderation/moderation-queue-cache-headers.middleware.ts`
import type { NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

/** Runs before the guards, so a 401 and a 403 carry the same headers as a 200. */
export class ModerationQueueCacheHeadersMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    response.setHeader('Cache-Control', 'private, no-store')
    response.vary('Authorization')
    next()
  }
}
