import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  prepareShareCardInputSchema,
  prepareShareCardResponseSchema,
} from '@couture/api-client/contracts/http'
import { toBadRequest } from '../../controllers/error-helpers.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { ShareCardsService } from './share-cards.service.js'

@Controller('/api/v1/share-cards')
@UseGuards(RequestAuthGuard)
export class ShareCardsController {
  constructor(@Inject(ShareCardsService) private readonly service: ShareCardsService) {}
  @Post('prepare')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async prepare(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const parsed = prepareShareCardInputSchema.safeParse(body)
    if (!parsed.success) return toBadRequest(parsed.error)
    const controller = new AbortController()
    const abort = () => controller.abort()
    const close = () => {
      if (!response.writableFinished) abort()
    }
    request.on('aborted', abort)
    response.on('close', close)
    if (request.aborted || response.destroyed) abort()
    try {
      return prepareShareCardResponseSchema.parse({
        data: await this.service.prepare(auth.userId, parsed.data, controller.signal),
      })
    } finally {
      request.off('aborted', abort)
      response.off('close', close)
    }
  }
}
